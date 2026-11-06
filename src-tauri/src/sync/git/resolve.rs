//! Finishing a merge that [`GitBackend::sync`] stopped on a conflict, from
//! the user's pick per file, a commit of the working tree on its own, and the
//! remote probe a first connect runs.
//!
//! A resolution never writes a file itself: it picks a side's index entry,
//! commits with both parents, and lets libgit2's checkout write the picked
//! paths, so its own checks on names a remote can send (`.git`, NTFS
//! aliases, links) still apply.

use std::collections::BTreeSet;
use std::path::Path;

use git2::{IndexEntry, RepositoryState};
use serde::Deserialize;

use crate::sync::{BackendKind, SyncError, SyncResult};

use super::backend::GitBackend;
use super::{auto_commit_message, merge_commit_message, now_unix, ORIGIN};

/// Which version of a conflicted file the user keeps.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ConflictSide {
    /// This machine's version (the merge's "ours").
    Local,
    /// The version that came from the remote ("theirs").
    Remote,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictPick {
    pub path: String,
    pub side: ConflictSide,
}

/// The file mode git gives a submodule entry. Checking one out would make
/// libgit2 open the submodule's repository, so a resolution refuses it.
const GITLINK_MODE: u32 = 0o160000;
/// The bits of an index entry's flags that hold its merge stage.
const STAGE_MASK: u16 = 0x3000;

impl GitBackend {
    /// Fetch, then report whether the remote's branch holds any of `paths`.
    /// A missing branch, or one with only a README, holds none.
    pub fn remote_holds_any(&self, paths: &[&str]) -> Result<bool, SyncError> {
        let repo = self.open_repo()?;
        self.fetch_remote(&repo)?;
        let upstream = format!("refs/remotes/{ORIGIN}/{}", self.config.remote_branch);
        let Ok(reference) = repo.find_reference(&upstream) else {
            return Ok(false);
        };
        let tree = reference
            .peel_to_tree()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let holds = paths.iter().any(|p| tree.get_path(Path::new(p)).is_ok());
        Ok(holds)
    }

    /// Stage and commit the working tree, with nothing fetched or pushed.
    /// `false` when there was nothing to commit.
    pub fn commit_all(&self) -> Result<bool, SyncError> {
        let repo = self.open_repo()?;
        if !Self::stage_all(&repo)? {
            return Ok(false);
        }
        let parents = Self::head_commit(&repo)?.into_iter().collect();
        let message = auto_commit_message(&repo)?;
        Self::commit_index(&repo, &self.signature()?, &message, parents)?;
        Ok(true)
    }

    /// Complete the merge in progress with one pick for every conflicted
    /// path, then push. The picks must name each conflicted path exactly
    /// once; anything else is refused before the index changes.
    pub fn resolve_conflicts(&self, picks: &[ConflictPick]) -> Result<SyncResult, SyncError> {
        let repo = self.open_repo()?;
        if repo.state() != RepositoryState::Merge {
            return Err(SyncError::InvalidState("no merge is in progress".into()));
        }
        let merge_head = repo
            .find_reference("MERGE_HEAD")
            .and_then(|r| r.peel_to_commit())
            .map_err(|e| SyncError::InvalidState(e.message().to_string()))?;
        let mut sides = Self::conflict_entries(&repo)?;
        let picked: BTreeSet<&str> = picks.iter().map(|p| p.path.as_str()).collect();
        let conflicted: BTreeSet<&str> = sides.keys().map(String::as_str).collect();
        if picked.len() != picks.len() || picked != conflicted {
            return Err(SyncError::InvalidState(
                "pick one side for every conflicted file, once".into(),
            ));
        }

        let mut index = repo
            .index()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        for pick in picks {
            let side = sides.remove(&pick.path).expect("checked above");
            let kept = match pick.side {
                ConflictSide::Local => side.ours,
                ConflictSide::Remote => side.theirs,
            };
            if kept.as_ref().is_some_and(|e| e.mode == GITLINK_MODE) {
                return Err(SyncError::InvalidState(format!(
                    "{} is a submodule and cannot be resolved here",
                    pick.path
                )));
            }
            index
                .conflict_remove(Path::new(&pick.path))
                .map_err(|e| SyncError::Backend(e.message().to_string()))?;
            // A side that deleted the file keeps it deleted: with its
            // conflict entries gone the path is simply absent.
            if let Some(entry) = kept {
                index
                    .add(&resolved(entry))
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
            }
        }
        let signature = self.signature()?;
        let head = Self::head_commit(&repo)?
            .ok_or_else(|| SyncError::InvalidState("HEAD missing during merge".into()))?;
        // Written only once committed: a failed commit leaves the conflicts
        // on disk to resolve again.
        Self::commit_tree_of(
            &repo,
            &mut index,
            &signature,
            &merge_commit_message(),
            vec![head, merge_head],
        )?;
        index
            .write()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        repo.cleanup_state()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;

        // The picked files still hold conflict markers on disk; check them
        // out from the new commit. Paths match literally, never as globs.
        let mut checkout = git2::build::CheckoutBuilder::new();
        checkout
            .force()
            .remove_untracked(true)
            .disable_pathspec_match(true);
        for pick in picks {
            checkout.path(pick.path.as_str());
        }
        repo.checkout_head(Some(&mut checkout))
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;

        let (pushed_count, _) = Self::ahead_behind(&repo, &self.config.remote_branch)?;
        self.push_branch(&repo)?;
        Ok(SyncResult {
            kind: BackendKind::Git,
            pulled_count: 1,
            committed_count: 1,
            pushed_count,
            conflicts: vec![],
            completed_unix: now_unix(),
        })
    }
}

/// `entry` moved to stage 0, the stage of a resolved file.
fn resolved(entry: IndexEntry) -> IndexEntry {
    IndexEntry {
        flags: entry.flags & !STAGE_MASK,
        ..entry
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;

    use git2::Repository;

    use super::super::test_support::Fixture;
    use super::*;
    use crate::sync::SyncBackend;

    fn pick(path: &str, side: ConflictSide) -> ConflictPick {
        ConflictPick {
            path: path.into(),
            side,
        }
    }

    /// `path` as the remote's branch holds it, or `None` when it is absent.
    fn remote_file(f: &Fixture, path: &str) -> Option<String> {
        let remote = Repository::open(&f.remote).unwrap();
        let tree = remote
            .find_reference("refs/heads/main")
            .unwrap()
            .peel_to_tree()
            .unwrap();
        let entry = tree.get_path(Path::new(path)).ok()?;
        let blob = remote.find_blob(entry.id()).unwrap();
        Some(String::from_utf8(blob.content().to_vec()).unwrap())
    }

    /// Both machines change `notes.md` from a shared base; the other one
    /// syncs first, so this one's sync stops on the conflict. `theirs` of
    /// `None` deletes the file on the other machine instead.
    fn conflicted(mine: Option<&str>, theirs: Option<&str>) -> Fixture {
        let f = Fixture::new();
        f.write_file("notes.md", "base\n");
        f.backend().sync(None).unwrap();
        let (other, other_backend) = f.other_clone("other");
        match theirs {
            Some(text) => fs::write(other.join("notes.md"), text).unwrap(),
            None => fs::remove_file(other.join("notes.md")).unwrap(),
        }
        fs::write(other.join("other-only.md"), "from other\n").unwrap();
        other_backend.sync(None).unwrap();
        match mine {
            Some(text) => f.write_file("notes.md", text),
            None => fs::remove_file(f.workspace.join("notes.md")).unwrap(),
        }
        let result = f.backend().sync(None).unwrap();
        assert_eq!(result.conflicts, ["notes.md"]);
        f
    }

    #[test]
    fn keeping_this_machines_version_commits_and_pushes_it() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        let result = f
            .backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Local)])
            .unwrap();
        assert!(result.conflicts.is_empty());
        assert!(result.pushed_count >= 1);
        assert_eq!(
            fs::read_to_string(f.workspace.join("notes.md")).unwrap(),
            "mine\n"
        );
        assert_eq!(remote_file(&f, "notes.md").as_deref(), Some("mine\n"));
        let status = f.backend().status().unwrap();
        assert!(status.clean && status.conflicts.is_empty(), "{status:?}");
    }

    #[test]
    fn taking_the_synced_version_replaces_this_machines_edit() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Remote)])
            .unwrap();
        assert_eq!(
            fs::read_to_string(f.workspace.join("notes.md")).unwrap(),
            "theirs\n"
        );
        assert_eq!(remote_file(&f, "notes.md").as_deref(), Some("theirs\n"));
    }

    #[test]
    fn the_merge_commit_has_both_parents_and_keeps_the_auto_merged_files() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Local)])
            .unwrap();
        let repo = Repository::open(&f.workspace).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        assert_eq!(head.parent_count(), 2);
        assert_eq!(repo.state(), RepositoryState::Clean);
        assert_eq!(
            remote_file(&f, "other-only.md").as_deref(),
            Some("from other\n")
        );
        assert!(f.workspace.join("other-only.md").exists());
    }

    #[test]
    fn a_resolved_merge_does_not_conflict_again_on_the_next_sync() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Local)])
            .unwrap();
        let again = f.backend().sync(None).unwrap();
        assert!(again.conflicts.is_empty());
        assert_eq!(again.committed_count, 0);
        assert_eq!(again.pushed_count, 0);
    }

    #[test]
    fn a_resolution_whose_commit_fails_can_be_made_again() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        // A held branch lock makes the merge commit fail.
        let lock = f.workspace.join(".git/refs/heads/main.lock");
        fs::write(&lock, "").unwrap();
        let picks = [pick("notes.md", ConflictSide::Local)];
        assert!(f.backend().resolve_conflicts(&picks).is_err());
        assert_eq!(f.backend().status().unwrap().conflicts, ["notes.md"]);

        fs::remove_file(&lock).unwrap();
        f.backend().resolve_conflicts(&picks).unwrap();
        assert_eq!(remote_file(&f, "notes.md").as_deref(), Some("mine\n"));
    }

    #[test]
    fn a_file_deleted_on_the_other_machine_goes_when_the_synced_side_is_taken() {
        let f = conflicted(Some("mine\n"), None);
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Remote)])
            .unwrap();
        assert!(!f.workspace.join("notes.md").exists());
        assert_eq!(remote_file(&f, "notes.md"), None);
        assert!(f.backend().status().unwrap().clean);
    }

    #[test]
    fn a_file_deleted_on_the_other_machine_stays_when_this_side_is_kept() {
        let f = conflicted(Some("mine\n"), None);
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Local)])
            .unwrap();
        assert_eq!(remote_file(&f, "notes.md").as_deref(), Some("mine\n"));
    }

    #[test]
    fn a_file_deleted_here_comes_back_when_the_synced_side_is_taken() {
        let f = conflicted(None, Some("theirs\n"));
        f.backend()
            .resolve_conflicts(&[pick("notes.md", ConflictSide::Remote)])
            .unwrap();
        assert_eq!(
            fs::read_to_string(f.workspace.join("notes.md")).unwrap(),
            "theirs\n"
        );
    }

    #[test]
    fn a_file_both_machines_added_resolves_to_the_picked_one() {
        let f = Fixture::new();
        f.write_file("seed.md", "seed\n");
        f.backend().sync(None).unwrap();
        let (other, other_backend) = f.other_clone("other");
        fs::write(other.join("new.md"), "theirs\n").unwrap();
        other_backend.sync(None).unwrap();
        f.write_file("new.md", "mine\n");
        assert_eq!(f.backend().sync(None).unwrap().conflicts, ["new.md"]);

        f.backend()
            .resolve_conflicts(&[pick("new.md", ConflictSide::Remote)])
            .unwrap();
        assert_eq!(remote_file(&f, "new.md").as_deref(), Some("theirs\n"));
    }

    #[test]
    fn picks_that_do_not_match_the_conflicts_exactly_change_nothing() {
        let f = conflicted(Some("mine\n"), Some("theirs\n"));
        let refused = [
            vec![],
            vec![pick("other-only.md", ConflictSide::Local)],
            vec![
                pick("notes.md", ConflictSide::Local),
                pick("notes.md", ConflictSide::Remote),
            ],
            vec![
                pick("notes.md", ConflictSide::Local),
                pick("../outside.md", ConflictSide::Local),
            ],
        ];
        for picks in refused {
            let err = f.backend().resolve_conflicts(&picks).unwrap_err();
            assert!(matches!(err, SyncError::InvalidState(_)), "{picks:?}");
            let status = f.backend().status().unwrap();
            assert_eq!(status.conflicts, ["notes.md"], "{picks:?}");
        }
        let repo = Repository::open(&f.workspace).unwrap();
        assert_eq!(repo.state(), RepositoryState::Merge);
    }

    #[test]
    fn a_submodule_side_of_a_conflict_is_refused() {
        let f = Fixture::new();
        f.write_file(
            "seed.md", "seed
",
        );
        f.backend().sync(None).unwrap();
        let repo = Repository::open(&f.workspace).unwrap();
        let head = repo.head().unwrap().target().unwrap();
        // A merge in progress whose one conflict has a submodule on this
        // machine's side and a file on the other.
        fs::write(
            f.workspace.join(".git/MERGE_HEAD"),
            format!(
                "{head}
"
            ),
        )
        .unwrap();
        let blob = repo
            .blob(
                b"a file
",
            )
            .unwrap();
        let mut index = repo.index().unwrap();
        for (stage, mode, id) in [(2u16, GITLINK_MODE, head), (3, 0o100644, blob)] {
            index
                .add(&IndexEntry {
                    ctime: git2::IndexTime::new(0, 0),
                    mtime: git2::IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode,
                    uid: 0,
                    gid: 0,
                    file_size: 0,
                    id,
                    flags: stage << 12,
                    flags_extended: 0,
                    path: b"sub".to_vec(),
                })
                .unwrap();
        }
        index.write().unwrap();
        assert_eq!(f.backend().status().unwrap().conflicts, ["sub"]);

        let err = f
            .backend()
            .resolve_conflicts(&[pick("sub", ConflictSide::Local)])
            .unwrap_err();
        assert!(matches!(err, SyncError::InvalidState(_)), "{err:?}");
        assert_eq!(f.backend().status().unwrap().conflicts, ["sub"]);
    }

    #[test]
    fn resolving_without_a_merge_in_progress_is_refused() {
        let f = Fixture::new();
        f.write_file("a.md", "a\n");
        f.backend().sync(None).unwrap();
        let err = f.backend().resolve_conflicts(&[]).unwrap_err();
        assert!(matches!(err, SyncError::InvalidState(_)), "{err:?}");
    }

    #[test]
    fn remote_holds_any_looks_for_the_paths_in_the_remote_branch() {
        let f = Fixture::new();
        assert!(!f.backend().remote_holds_any(&["settings"]).unwrap());
        f.write_file("README.md", "hi\n");
        f.backend().sync(None).unwrap();
        let (_, other_backend) = f.other_clone("other");
        assert!(!other_backend.remote_holds_any(&["settings"]).unwrap());
        assert!(other_backend
            .remote_holds_any(&["settings", "README.md"])
            .unwrap());
    }

    #[test]
    fn commit_all_commits_without_touching_the_remote() {
        let f = Fixture::new();
        assert!(!f.backend().commit_all().unwrap());
        f.write_file("a.md", "a\n");
        assert!(f.backend().commit_all().unwrap());
        assert!(f.backend().status().unwrap().clean);
        assert!(!f.backend().commit_all().unwrap());
        let remote = Repository::open(&f.remote).unwrap();
        assert!(remote.find_reference("refs/heads/main").is_err());
    }
}
