//! Low-level repository queries and operations behind [`GitBackend`]: staging,
//! committing, ahead/behind counts, conflict collection, and the fetch/push
//! transport. Split from `backend.rs` so that file holds the `SyncBackend`
//! implementation (the sync orchestration) and this one the git plumbing it
//! calls.

use std::path::Path;

use git2::{BranchType, FetchOptions, PushOptions, Repository, StatusOptions};

use crate::sync::SyncError;

use super::backend::GitBackend;
use super::{map_remote_error, ORIGIN};

impl GitBackend {
    /// True if the working tree differs from HEAD in any visible way.
    pub(super) fn working_tree_dirty(repo: &Repository) -> Result<bool, SyncError> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);
        let statuses = repo
            .statuses(Some(&mut opts))
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        Ok(!statuses.is_empty())
    }

    /// Stage every change in the working tree (mirror of `git add -A`).
    pub(super) fn stage_all(repo: &Repository) -> Result<bool, SyncError> {
        let mut index = repo
            .index()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        index
            .write()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;

        // Did the index actually move? Returns true when there is
        // something staged that would produce a real commit.
        let head_tree = match repo.head() {
            Ok(head) => head
                .peel_to_tree()
                .map_err(|e| SyncError::Backend(e.message().to_string()))?,
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => {
                // No commits yet — anything in the index counts as a
                // change.
                return Ok(!index.is_empty());
            }
            // Defensive: libgit2's `repo.head()` either succeeds, returns
            // `UnbornBranch` (handled above), or surfaces a lower-level
            // I/O failure (corrupt refs file etc.) we don't try to
            // recover from. Not reachable in normal use, so no test.
            Err(e) => return Err(SyncError::Backend(e.message().to_string())),
        };
        let index_tree_oid = index
            .write_tree()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let index_tree = repo
            .find_tree(index_tree_oid)
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let diff = repo
            .diff_tree_to_tree(Some(&head_tree), Some(&index_tree), None)
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        Ok(diff.deltas().len() > 0)
    }

    pub(super) fn commit_index(
        repo: &Repository,
        signature: &git2::Signature<'_>,
        message: &str,
        parents: Vec<git2::Commit<'_>>,
    ) -> Result<git2::Oid, SyncError> {
        let mut index = repo
            .index()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let tree_oid = index
            .write_tree()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let tree = repo
            .find_tree(tree_oid)
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let parent_refs: Vec<&git2::Commit<'_>> = parents.iter().collect();
        repo.commit(
            Some("HEAD"),
            signature,
            signature,
            message,
            &tree,
            &parent_refs,
        )
        .map_err(|e| SyncError::Backend(e.message().to_string()))
    }

    pub(super) fn head_commit(repo: &Repository) -> Result<Option<git2::Commit<'_>>, SyncError> {
        match repo.head() {
            Ok(head) => head
                .peel_to_commit()
                .map(Some)
                .map_err(|e| SyncError::Backend(e.message().to_string())),
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => Ok(None),
            // Same defensive fallthrough as `stage_all` — non-`UnbornBranch`
            // `repo.head()` failures are corrupt-repo territory; we surface
            // a Backend error and let the user re-clone.
            Err(e) => Err(SyncError::Backend(e.message().to_string())),
        }
    }

    /// Return (ahead, behind) of the local branch relative to its
    /// remote-tracking branch. Returns (0, 0) when there is no upstream
    /// configured yet (fresh init before the first push).
    pub(super) fn ahead_behind(
        repo: &Repository,
        branch_name: &str,
    ) -> Result<(u32, u32), SyncError> {
        let local = match repo.find_branch(branch_name, BranchType::Local) {
            Ok(b) => b,
            Err(_) => return Ok((0, 0)),
        };
        let upstream_ref = format!("refs/remotes/{ORIGIN}/{branch_name}");
        let upstream = match repo.find_reference(&upstream_ref) {
            Ok(r) => r,
            Err(_) => return Ok((0, 0)),
        };
        let local_oid = local
            .get()
            .target()
            .ok_or_else(|| SyncError::InvalidState("local branch has no tip".into()))?;
        let upstream_oid = upstream
            .target()
            .ok_or_else(|| SyncError::InvalidState("upstream ref has no tip".into()))?;
        repo.graph_ahead_behind(local_oid, upstream_oid)
            .map(|(a, b)| (a as u32, b as u32))
            .map_err(|e| SyncError::Backend(e.message().to_string()))
    }

    pub(super) fn collect_conflicts(repo: &Repository) -> Result<Vec<String>, SyncError> {
        let mut out = Vec::new();
        let index = repo
            .index()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        if !index.has_conflicts() {
            return Ok(out);
        }
        let conflicts = index
            .conflicts()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        for entry in conflicts {
            let entry = entry.map_err(|e| SyncError::Backend(e.message().to_string()))?;
            // Prefer the "ours" path; fall back to "theirs"/"ancestor".
            let path = entry
                .our
                .as_ref()
                .or(entry.their.as_ref())
                .or(entry.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).into_owned());
            if let Some(p) = path {
                out.push(p);
            }
        }
        out.sort();
        out.dedup();
        Ok(out)
    }

    /// Whether a remote is configured for this workspace. An empty
    /// `remote_url` means local-only sync: Glyph still stages and commits
    /// changes into the repo's history, but there is nothing to fetch,
    /// merge, or push.
    pub(super) fn has_remote(&self) -> bool {
        !self.config.remote_url.trim().is_empty()
    }

    pub(super) fn fetch_remote(&self, repo: &Repository) -> Result<(), SyncError> {
        let mut remote = repo
            .find_remote(ORIGIN)
            .map_err(|_| SyncError::NotConfigured)?;
        let mut opts = FetchOptions::new();
        opts.remote_callbacks(self.credentials_callbacks());
        let refspec = format!(
            "refs/heads/{0}:refs/remotes/{ORIGIN}/{0}",
            self.config.remote_branch
        );
        remote
            .fetch(&[&refspec], Some(&mut opts), None)
            .map_err(map_remote_error)?;
        Ok(())
    }

    pub(super) fn push_branch(&self, repo: &Repository) -> Result<(), SyncError> {
        let mut remote = repo
            .find_remote(ORIGIN)
            .map_err(|_| SyncError::NotConfigured)?;
        let mut opts = PushOptions::new();
        opts.remote_callbacks(self.credentials_callbacks());
        let refspec = format!("refs/heads/{0}:refs/heads/{0}", self.config.remote_branch);
        remote
            .push(&[&refspec], Some(&mut opts))
            .map_err(map_remote_error)?;
        Ok(())
    }

    /// Whether the `.glyph/` config directory is already present in HEAD.
    /// `false` on an unborn branch (no commits yet).
    pub(super) fn config_tracked(repo: &Repository) -> Result<bool, SyncError> {
        let head_tree = match repo.head() {
            Ok(h) => h
                .peel_to_tree()
                .map_err(|e| SyncError::Backend(e.message().to_string()))?,
            Err(e) if e.code() == git2::ErrorCode::UnbornBranch => return Ok(false),
            Err(e) => return Err(SyncError::Backend(e.message().to_string())),
        };
        Ok(head_tree
            .get_path(Path::new(&format!(".{}", crate::APP_NAME)))
            .is_ok())
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use git2::Repository;

    use super::super::test_support::Fixture;
    use super::GitBackend;

    /// A HEAD file libgit2 can neither resolve nor call unborn: the
    /// corrupt-repo case each `repo.head()` call site has to survive.
    fn corrupt_head(f: &Fixture) -> Repository {
        fs::write(f.workspace.join(".git/HEAD"), "not a ref\n").unwrap();
        Repository::open(&f.workspace).unwrap()
    }

    #[test]
    fn stage_all_surfaces_a_corrupt_head_as_a_backend_error() {
        let f = Fixture::new();
        f.write_file("note.md", "hello");
        let repo = corrupt_head(&f);
        assert!(GitBackend::stage_all(&repo).is_err());
    }

    #[test]
    fn head_commit_surfaces_a_corrupt_head_as_a_backend_error() {
        let f = Fixture::new();
        let repo = corrupt_head(&f);
        assert!(GitBackend::head_commit(&repo).is_err());
    }

    #[test]
    fn config_tracked_surfaces_a_corrupt_head_as_a_backend_error() {
        let f = Fixture::new();
        let repo = corrupt_head(&f);
        assert!(GitBackend::config_tracked(&repo).is_err());
    }
}
