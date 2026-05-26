//! Git-backed sync. Built on `git2` (statically-linked libgit2) so end
//! users don't need a system `git` install — the entire backend ships
//! inside the Glyph binary.
//!
//! Sync flow when [`GitBackend::sync`] is called:
//!
//! 1. Stage every change in the working tree (`git add -A`).
//! 2. If there is anything staged, create a `glyph: auto-commit` commit
//!    on the current branch using the configured author identity (or
//!    libgit2's global config as a fallback).
//! 3. Fetch the configured remote branch.
//! 4. Fast-forward when possible. If fast-forward isn't possible, merge
//!    the remote into the local branch with libgit2's merge analysis:
//!    success → commit the merge; conflicts → surface them in
//!    [`super::backend::SyncResult::conflicts`] and stop without pushing
//!    so the user can resolve.
//! 5. Push the local branch to the remote.
//!
//! Status is computed without touching the network: it counts dirty
//! files in the index, then compares the current branch's tip against
//! its upstream's last-known SHA for ahead / behind. The next sync call
//! fetches and recomputes from real refs.
//!
//! Credentials: for v1 we only handle HTTPS + a static PAT-style token.
//! SSH-agent / per-key flows land in a follow-up PR; the credential
//! callback in this module is where they will attach.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use git2::{
    BranchType, FetchOptions, MergeOptions, PushOptions, RemoteCallbacks, Repository, StatusOptions,
};

use super::backend::{BackendKind, StatusReport, SyncBackend, SyncResult};
use super::config::WorkspaceSyncConfig;
use super::error::SyncError;

/// Default commit message Glyph uses when it auto-commits local
/// changes during a sync. The user always sees a real "you wrote
/// notes" history in their repo, but they don't have to author each
/// commit by hand.
const AUTO_COMMIT_MESSAGE: &str = "glyph: auto-commit local changes";
/// What we call the merge commit when we have to reconcile remote.
const MERGE_COMMIT_MESSAGE: &str = "glyph: merge remote changes";
/// Remote name we look up; matches `git clone`'s default.
const ORIGIN: &str = "origin";

pub struct GitBackend {
    config: WorkspaceSyncConfig,
    /// Optional plaintext token used for HTTPS basic-auth. v1 hardcoded
    /// to "x-access-token" username (GitHub / Codeberg / GitLab all
    /// accept it). SSH key flow comes in a follow-up.
    https_token: Option<String>,
}

impl GitBackend {
    pub fn new(config: WorkspaceSyncConfig) -> Self {
        Self {
            config,
            https_token: None,
        }
    }

    /// Attach an HTTPS PAT/token. Used for private remotes; public
    /// HTTPS clones don't need a token at all.
    pub fn with_https_token(mut self, token: impl Into<String>) -> Self {
        self.https_token = Some(token.into());
        self
    }

    fn workspace(&self) -> &Path {
        Path::new(&self.config.workspace_path)
    }

    /// Open the workspace as a Git repo. Surfaces a clear error if the
    /// folder hasn't been `git init`'d / cloned yet — callers should
    /// route that into the "set up sync" flow instead of treating it
    /// as a generic failure. Any other libgit2 error (corrupt `.git`,
    /// permission issues, etc.) falls through to `Backend`.
    fn open_repo(&self) -> Result<Repository, SyncError> {
        Repository::open(self.workspace()).map_err(|e| match e.code() {
            git2::ErrorCode::NotFound => SyncError::NotConfigured,
            _ => SyncError::Backend(e.message().to_string()),
        })
    }

    /// Build the libgit2 credentials callback. Used for both fetch and
    /// push. Delegates the cred-shape selection to the free function
    /// returned by [`make_credentials_callback`] so the closure body
    /// itself can be exercised without a real authenticated remote.
    fn credentials_callbacks(&self) -> RemoteCallbacks<'_> {
        let mut cb = RemoteCallbacks::new();
        cb.credentials(make_credentials_callback(self.https_token.clone()));
        cb
    }

    fn signature(&self) -> Result<git2::Signature<'static>, SyncError> {
        if let Some(author) = &self.config.author {
            return git2::Signature::now(&author.name, &author.email)
                .map_err(|e| SyncError::Backend(e.message().to_string()));
        }
        // No explicit author configured — try git's global config.
        let cfg = git2::Config::open_default()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let name = cfg
            .get_string("user.name")
            .unwrap_or_else(|_| "Glyph".to_string());
        let email = cfg
            .get_string("user.email")
            .unwrap_or_else(|_| "glyph@localhost".to_string());
        git2::Signature::now(&name, &email).map_err(|e| SyncError::Backend(e.message().to_string()))
    }

    /// True if the working tree differs from HEAD in any visible way.
    fn working_tree_dirty(repo: &Repository) -> Result<bool, SyncError> {
        let mut opts = StatusOptions::new();
        opts.include_untracked(true);
        opts.recurse_untracked_dirs(true);
        let statuses = repo
            .statuses(Some(&mut opts))
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        Ok(!statuses.is_empty())
    }

    /// Stage every change in the working tree (mirror of `git add -A`).
    fn stage_all(repo: &Repository) -> Result<bool, SyncError> {
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

    fn commit_index(
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

    fn head_commit(repo: &Repository) -> Result<Option<git2::Commit<'_>>, SyncError> {
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
    fn ahead_behind(repo: &Repository, branch_name: &str) -> Result<(u32, u32), SyncError> {
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

    fn collect_conflicts(repo: &Repository) -> Result<Vec<String>, SyncError> {
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

    fn fetch_remote(&self, repo: &Repository) -> Result<(), SyncError> {
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

    fn push_branch(&self, repo: &Repository) -> Result<(), SyncError> {
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
}

impl SyncBackend for GitBackend {
    fn kind(&self) -> BackendKind {
        BackendKind::Git
    }

    fn status(&self) -> Result<StatusReport, SyncError> {
        let repo = self.open_repo()?;
        let dirty = Self::working_tree_dirty(&repo)?;
        let (ahead, behind) = Self::ahead_behind(&repo, &self.config.remote_branch)?;
        let conflicts = Self::collect_conflicts(&repo)?;
        Ok(StatusReport {
            kind: BackendKind::Git,
            clean: !dirty,
            ahead,
            behind,
            conflicts,
            last_sync_unix: None,
        })
    }

    fn sync(&self, commit_message: Option<&str>) -> Result<SyncResult, SyncError> {
        let repo = self.open_repo()?;
        let signature = self.signature()?;

        // Refuse to sync until existing conflicts are resolved. The
        // user has to take action; we can't push or fast-forward over a
        // conflicted index.
        let existing_conflicts = Self::collect_conflicts(&repo)?;
        if !existing_conflicts.is_empty() {
            return Err(SyncError::Conflict(existing_conflicts));
        }

        // 1. Stage everything and commit if there's anything new.
        let staged = Self::stage_all(&repo)?;
        let mut committed_count = 0;
        if staged {
            let parents = match Self::head_commit(&repo)? {
                Some(c) => vec![c],
                None => vec![],
            };
            let trimmed = commit_message.map(str::trim).filter(|s| !s.is_empty());
            let message = match trimmed {
                Some(m) => m.to_string(),
                None => auto_commit_message(&repo)?,
            };
            Self::commit_index(&repo, &signature, &message, parents)?;
            committed_count = 1;
        }

        // 2. Fetch the remote.
        self.fetch_remote(&repo)?;

        // 3. Analyse remote relative to local and reconcile.
        let mut pulled_count = 0;
        let upstream_ref = format!("refs/remotes/{ORIGIN}/{}", self.config.remote_branch);
        if let Ok(upstream) = repo.find_reference(&upstream_ref) {
            let upstream_commit = upstream
                .peel_to_commit()
                .map_err(|e| SyncError::Backend(e.message().to_string()))?;
            let upstream_oid = upstream_commit.id();
            let upstream_annotated = repo
                .find_annotated_commit(upstream_oid)
                .map_err(|e| SyncError::Backend(e.message().to_string()))?;
            let (analysis, _) = repo
                .merge_analysis(&[&upstream_annotated])
                .map_err(|e| SyncError::Backend(e.message().to_string()))?;

            if analysis.is_up_to_date() {
                // Local already contains everything from upstream — no-op.
            } else if analysis.is_fast_forward() {
                // Fast-forward: move local branch pointer to upstream
                // and check out the new tree.
                let local_ref_name = format!("refs/heads/{}", self.config.remote_branch);
                let mut local_ref = repo
                    .find_reference(&local_ref_name)
                    .or_else(|_| repo.reference(&local_ref_name, upstream_oid, true, "ff init"))
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
                local_ref
                    .set_target(upstream_oid, "glyph: fast-forward to upstream")
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
                repo.set_head(&local_ref_name)
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
                let mut co = git2::build::CheckoutBuilder::default();
                co.force();
                repo.checkout_head(Some(&mut co))
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
                pulled_count = 1;
            } else {
                // True merge needed.
                let mut merge_opts = MergeOptions::new();
                let mut checkout_opts = git2::build::CheckoutBuilder::new();
                checkout_opts.allow_conflicts(true);
                repo.merge(
                    &[&upstream_annotated],
                    Some(&mut merge_opts),
                    Some(&mut checkout_opts),
                )
                .map_err(|e| SyncError::Backend(e.message().to_string()))?;

                let conflicts = Self::collect_conflicts(&repo)?;
                if !conflicts.is_empty() {
                    // Leave the repo in the merging state so the user
                    // can resolve. Skip push.
                    return Ok(SyncResult {
                        kind: BackendKind::Git,
                        pulled_count: 0,
                        committed_count,
                        pushed_count: 0,
                        conflicts,
                        completed_unix: now_unix(),
                    });
                }

                // No conflicts — write the merge commit.
                let head = Self::head_commit(&repo)?
                    .ok_or_else(|| SyncError::InvalidState("HEAD missing during merge".into()))?;
                Self::commit_index(
                    &repo,
                    &signature,
                    MERGE_COMMIT_MESSAGE,
                    vec![head, upstream_commit],
                )?;
                repo.cleanup_state()
                    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
                pulled_count = 1;
            }
        }

        // 4. Push the (possibly newly-extended) local branch.
        let (ahead, _) = Self::ahead_behind(&repo, &self.config.remote_branch)?;
        let mut pushed_count = 0;
        if ahead > 0 || committed_count > 0 {
            self.push_branch(&repo)?;
            pushed_count = ahead.max(committed_count);
        }

        Ok(SyncResult {
            kind: BackendKind::Git,
            pulled_count,
            committed_count,
            pushed_count,
            conflicts: vec![],
            completed_unix: now_unix(),
        })
    }
}

fn map_remote_error(e: git2::Error) -> SyncError {
    let msg = e.message().to_string();
    match e.class() {
        git2::ErrorClass::Net | git2::ErrorClass::Http => SyncError::Network(msg),
        git2::ErrorClass::Ssh | git2::ErrorClass::Callback => SyncError::AuthFailed(msg),
        _ if msg.contains("authentication") || msg.contains("auth") => SyncError::AuthFailed(msg),
        _ => SyncError::Backend(msg),
    }
}

fn now_unix() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Generate a GitHub-style commit subject from the diff between HEAD
/// and the current index. Mirrors what GitHub's web editor produces
/// when you commit through the file browser:
///
/// - one add/delete/modify: `Create|Delete|Update <basename>`
/// - two or three deltas: `Create|Delete|Update a, b[, c]` (verb
///   matches when all deltas are the same kind, falls back to `Update`)
/// - four or more: `Create|Delete|Update first, second and N more files`
///
/// Falls back to the legacy `AUTO_COMMIT_MESSAGE` when libgit2 reports
/// no deltas (e.g. an unexpected state where the index didn't actually
/// move). Callers only invoke this when `stage_all` returned `true`, so
/// that path is defensive.
pub fn auto_commit_message(repo: &Repository) -> Result<String, SyncError> {
    let index = repo
        .index()
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;

    // The diff source: index relative to HEAD's tree, or relative to no
    // tree at all on an unborn branch (every path becomes an Added).
    let head_tree = match repo.head() {
        Ok(head) => Some(
            head.peel_to_tree()
                .map_err(|e| SyncError::Backend(e.message().to_string()))?,
        ),
        Err(e) if e.code() == git2::ErrorCode::UnbornBranch => None,
        Err(e) => return Err(SyncError::Backend(e.message().to_string())),
    };
    let diff = repo
        .diff_tree_to_index(head_tree.as_ref(), Some(&index), None)
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;

    #[derive(Clone, Copy, PartialEq, Eq)]
    enum Kind {
        Added,
        Deleted,
        Modified,
    }

    let mut entries: Vec<(Kind, String)> = Vec::new();
    for delta in diff.deltas() {
        let kind = match delta.status() {
            git2::Delta::Added | git2::Delta::Copied | git2::Delta::Untracked => Kind::Added,
            git2::Delta::Deleted => Kind::Deleted,
            // Modified / Renamed / Typechange / anything else with content
            // changes are presented as "Update".
            _ => Kind::Modified,
        };
        // Prefer the new path; fall back to the old path for deletes.
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.file_name())
            .map(|s| s.to_string_lossy().into_owned());
        if let Some(p) = path {
            entries.push((kind, p));
        }
    }

    if entries.is_empty() {
        return Ok(AUTO_COMMIT_MESSAGE.to_string());
    }

    let all_added = entries.iter().all(|(k, _)| *k == Kind::Added);
    let all_deleted = entries.iter().all(|(k, _)| *k == Kind::Deleted);
    let verb = if all_added {
        "Create"
    } else if all_deleted {
        "Delete"
    } else {
        "Update"
    };

    let names: Vec<&str> = entries.iter().map(|(_, n)| n.as_str()).collect();
    let msg = match names.as_slice() {
        [one] => format!("{verb} {one}"),
        [a, b] => format!("{verb} {a}, {b}"),
        [a, b, c] => format!("{verb} {a}, {b}, {c}"),
        many => {
            let rest = many.len() - 2;
            format!("{verb} {}, {} and {rest} more files", many[0], many[1])
        }
    };
    Ok(msg)
}

/// Initialise a new git repository at `path` with the default branch
/// set to the supplied name. Convenience wrapper around `git2::Repository::init_opts`.
pub fn init_repo(path: &Path, default_branch: &str) -> Result<PathBuf, SyncError> {
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head(default_branch);
    Repository::init_opts(path, &opts).map_err(|e| SyncError::Backend(e.message().to_string()))?;
    Ok(path.to_path_buf())
}

/// Build the FnMut closure libgit2 hands to `credentials()`. Returns
/// `impl FnMut` directly so it's reusable from fetch/push and
/// clone, and the body is reachable from tests (call the returned
/// closure with synthetic args).
pub fn make_credentials_callback(
    token: Option<String>,
) -> impl FnMut(&str, Option<&str>, git2::CredentialType) -> Result<git2::Cred, git2::Error> {
    move |_url, username_from_url, allowed| {
        select_credentials(allowed, username_from_url, token.as_deref())
    }
}

/// Select libgit2 credentials based on what auth method the remote
/// advertised and what we have stashed. Used by both fetch/push and
/// clone. Extracted so we can drive it from tests with synthetic
/// `CredentialType` bitflags instead of needing a real authenticated
/// remote.
///
/// Preference order:
/// 1. HTTPS basic-auth with the supplied token if the remote will accept
///    username/password and we have one. We use `x-access-token` as the
///    username because GitHub treats it as a magic PAT username; GitLab
///    and Codeberg accept any non-empty username.
/// 2. SSH agent if the remote wants a key (`git@host:repo.git` style).
/// 3. libgit2's default (anonymous HTTPS for public remotes, etc.).
pub fn select_credentials(
    allowed: git2::CredentialType,
    username_from_url: Option<&str>,
    token: Option<&str>,
) -> Result<git2::Cred, git2::Error> {
    if allowed.is_user_pass_plaintext() {
        if let Some(t) = token {
            return git2::Cred::userpass_plaintext("x-access-token", t);
        }
    }
    if allowed.is_ssh_key() {
        // Defensive: requires a running ssh-agent on the host. CI hosts
        // don't have one, so this arm isn't covered by the unit tests.
        // Manual verification with `eval "$(ssh-agent)"; ssh-add` + a
        // git@ remote is the validation path. The follow-up OS-keychain
        // PR will replace this with a stored-key flow.
        let user = username_from_url.unwrap_or("git");
        return git2::Cred::ssh_key_from_agent(user);
    }
    git2::Cred::default()
}

/// Clone `url` into `path`. The destination must not exist yet (libgit2's
/// rule). When `token` is supplied it's used as the HTTPS basic-auth
/// password with the `x-access-token` username (the GitHub PAT shape,
/// also accepted by GitLab / Codeberg). Without a token, we fall back
/// to the SSH agent for `git@` URLs and unauthenticated HTTPS for public
/// remotes.
pub fn clone_repo(url: &str, path: &Path, token: Option<&str>) -> Result<PathBuf, SyncError> {
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(make_credentials_callback(token.map(|t| t.to_string())));
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(callbacks);
    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fo);
    builder.clone(url, path).map_err(map_remote_error)?;
    Ok(path.to_path_buf())
}

/// Add an `origin` remote pointing at `url` to a repository at `path`.
pub fn set_origin(path: &Path, url: &str) -> Result<(), SyncError> {
    let repo = Repository::open(path).map_err(|e| SyncError::Backend(e.message().to_string()))?;
    match repo.find_remote(ORIGIN) {
        Ok(_) => repo.remote_set_url(ORIGIN, url),
        Err(_) => repo.remote(ORIGIN, url).map(|_| ()),
    }
    .map_err(|e| SyncError::Backend(e.message().to_string()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    /// Build a self-contained Git test harness:
    /// - `remote/` is a bare repository acting as the cloud
    /// - `local/` clones from it, with the working tree we'll mutate
    /// - returns the [`TempDir`] (drop = cleanup), the workspace path,
    ///   and a backend wired up to it
    struct Fixture {
        _tmp: TempDir,
        workspace: PathBuf,
        remote: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let tmp = TempDir::new().unwrap();
            let remote = tmp.path().join("remote.git");
            // `init_bare` alone honours the runner's `init.defaultBranch`
            // config — GitHub Actions hosts default to "master" because
            // they don't set `init.defaultBranch`, which makes
            // `Repository::clone` resolve HEAD to a non-existent branch
            // and breaks the merge scenarios below. Pin via init_opts so
            // the fixture is deterministic regardless of host config.
            let mut opts = git2::RepositoryInitOptions::new();
            opts.bare(true);
            opts.initial_head(super::super::DEFAULT_REMOTE_BRANCH);
            git2::Repository::init_opts(&remote, &opts).unwrap();
            let workspace = tmp.path().join("local");
            fs::create_dir_all(&workspace).unwrap();
            init_repo(&workspace, super::super::DEFAULT_REMOTE_BRANCH).unwrap();
            set_origin(&workspace, remote.to_str().unwrap()).unwrap();
            // libgit2 needs *some* author identity for commits.
            let cfg_path = workspace.join(".git/config");
            let mut cfg = git2::Config::open(&cfg_path).unwrap();
            cfg.set_str("user.name", "Test User").unwrap();
            cfg.set_str("user.email", "test@example.com").unwrap();
            Self {
                _tmp: tmp,
                workspace,
                remote,
            }
        }

        fn backend(&self) -> GitBackend {
            let mut cfg = WorkspaceSyncConfig::new_git(self.workspace.to_string_lossy());
            cfg.remote_url = self.remote.to_string_lossy().into();
            cfg.author = Some(super::super::config::CommitIdentity {
                name: "Test User".into(),
                email: "test@example.com".into(),
            });
            GitBackend::new(cfg)
        }

        fn write_file(&self, name: &str, contents: &str) {
            fs::write(self.workspace.join(name), contents).unwrap();
        }
    }

    #[test]
    fn open_repo_errors_with_not_configured_when_workspace_isnt_a_repo() {
        let tmp = TempDir::new().unwrap();
        let cfg = WorkspaceSyncConfig::new_git(tmp.path().to_string_lossy());
        let backend = GitBackend::new(cfg);
        let err = backend.status().unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured), "got: {err:?}");
    }

    #[test]
    fn open_repo_errors_with_backend_when_dot_git_is_corrupt() {
        // Replace the `.git` subdir libgit2 expects with a regular file
        // containing garbage. `Repository::open` reaches it (so it's not
        // NotFound) and reports something like `BadFile` / `Repository`
        // — exercises the `_ => Backend` arm of `open_repo`.
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().join("corrupt");
        fs::create_dir_all(&workspace).unwrap();
        fs::write(workspace.join(".git"), "this is not a gitfile\n").unwrap();
        let cfg = WorkspaceSyncConfig::new_git(workspace.to_string_lossy());
        let backend = GitBackend::new(cfg);
        let err = backend.status().unwrap_err();
        assert!(
            matches!(err, SyncError::Backend(_)),
            "expected Backend error from corrupt .git file, got {err:?}"
        );
    }

    /// Helper: `git2::Cred::credtype()` returns a raw libgit2 cred type
    /// as a `u32` rather than the typed `CredentialType` bitflag, so we
    /// bit-AND against the bitflag's `bits()` to check what was selected.
    fn cred_has(cred: &git2::Cred, kind: git2::CredentialType) -> bool {
        cred.credtype() & kind.bits() != 0
    }

    #[test]
    fn make_credentials_callback_forwards_to_select_credentials() {
        // The closure body is one call to `select_credentials`; we
        // exercise it directly with synthetic args so the closure lines
        // get coverage even without an authenticated remote handshake.
        let mut cb = make_credentials_callback(Some("ghp_xyz".into()));
        let cred = cb(
            "https://example.com/repo.git",
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT,
        )
        .expect("userpass cred");
        assert!(cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT));

        // Same callback called a second time with no token in scope —
        // confirms the closure captures and reuses the token via the
        // FnMut closure trait.
        let mut cb_no_token = make_credentials_callback(None);
        let cred = cb_no_token(
            "https://example.com/repo.git",
            None,
            git2::CredentialType::USER_PASS_PLAINTEXT,
        )
        .expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn select_credentials_returns_userpass_when_https_basic_auth_is_allowed_and_token_present() {
        let cred = select_credentials(
            git2::CredentialType::USER_PASS_PLAINTEXT,
            None,
            Some("ghp_secret"),
        )
        .expect("userpass cred");
        assert!(cred_has(&cred, git2::CredentialType::USER_PASS_PLAINTEXT));
    }

    #[test]
    fn select_credentials_falls_through_to_default_when_no_token_for_https() {
        // Remote will accept userpass but we have nothing to give. With
        // only USER_PASS_PLAINTEXT advertised, we end up at the libgit2
        // default cred, which is what unauthenticated HTTPS uses.
        let cred = select_credentials(git2::CredentialType::USER_PASS_PLAINTEXT, None, None)
            .expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn select_credentials_returns_default_when_no_supported_methods_are_allowed() {
        // Remote advertises something we don't handle (e.g. NTLM). Falls
        // through to libgit2's default credential.
        let cred =
            select_credentials(git2::CredentialType::USERNAME, None, None).expect("default cred");
        assert!(cred_has(&cred, git2::CredentialType::DEFAULT));
    }

    #[test]
    fn status_is_clean_on_a_fresh_repo() {
        let f = Fixture::new();
        let status = f.backend().status().unwrap();
        assert!(status.clean);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
        assert!(status.conflicts.is_empty());
    }

    #[test]
    fn status_reports_dirty_when_files_are_modified() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi");
        let status = f.backend().status().unwrap();
        assert!(!status.clean);
    }

    #[test]
    fn sync_commits_and_pushes_local_changes() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hello\n");
        let result = f.backend().sync(None).unwrap();
        assert_eq!(result.kind, BackendKind::Git);
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pulled_count, 0);
        assert_eq!(result.pushed_count, 1);
        assert!(result.conflicts.is_empty());

        // The bare remote should now contain the commit. With `None` for
        // the message, the backend auto-generates a GitHub-style subject
        // from the staged diff — a single new file becomes "Create <name>".
        let remote = Repository::open_bare(&f.remote).unwrap();
        let head = remote.find_reference("refs/heads/main").unwrap();
        let commit = head.peel_to_commit().unwrap();
        assert_eq!(commit.message().unwrap(), "Create notes.md");
    }

    #[test]
    fn sync_uses_an_explicit_commit_message_when_supplied() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hello\n");
        f.backend().sync(Some("test commit")).unwrap();
        let remote = Repository::open_bare(&f.remote).unwrap();
        let head = remote.find_reference("refs/heads/main").unwrap();
        let commit = head.peel_to_commit().unwrap();
        assert_eq!(commit.message().unwrap(), "test commit");
    }

    #[test]
    fn sync_falls_back_to_auto_message_when_supplied_blank() {
        // Whitespace-only is treated identically to `None`.
        let f = Fixture::new();
        f.write_file("notes.md", "# hello\n");
        f.backend().sync(Some("   ")).unwrap();
        let remote = Repository::open_bare(&f.remote).unwrap();
        let commit = remote
            .find_reference("refs/heads/main")
            .unwrap()
            .peel_to_commit()
            .unwrap();
        assert_eq!(commit.message().unwrap(), "Create notes.md");
    }

    #[test]
    fn sync_with_no_local_changes_is_a_noop() {
        let f = Fixture::new();
        // Seed a commit so HEAD exists.
        f.write_file("seed.md", "# seed\n");
        f.backend().sync(None).unwrap();
        // Second call should report no work.
        let result = f.backend().sync(None).unwrap();
        assert_eq!(result.committed_count, 0);
        assert_eq!(result.pulled_count, 0);
        assert_eq!(result.pushed_count, 0);
    }

    #[test]
    fn sync_fast_forwards_when_remote_advanced() {
        // Set up: workspace A and workspace B both clone from `remote`.
        // A commits + pushes; B sync should fast-forward.
        let f = Fixture::new();
        f.write_file("a.md", "# a\n");
        f.backend().sync(None).unwrap();

        // Clone a second working copy from the same bare remote.
        let other = f._tmp.path().join("other");
        Repository::clone(f.remote.to_str().unwrap(), &other).unwrap();
        let mut other_cfg = WorkspaceSyncConfig::new_git(other.to_string_lossy());
        other_cfg.remote_url = f.remote.to_string_lossy().into();
        other_cfg.author = Some(super::super::config::CommitIdentity {
            name: "Other User".into(),
            email: "other@example.com".into(),
        });
        let other_backend = GitBackend::new(other_cfg);

        // Now write a new file in A, push it.
        f.write_file("b.md", "# b\n");
        f.backend().sync(None).unwrap();

        // B should fast-forward and pick up b.md.
        let result = other_backend.sync(None).unwrap();
        assert_eq!(result.pulled_count, 1);
        assert!(other.join("b.md").exists());
    }

    #[test]
    fn sync_records_a_completed_timestamp() {
        let f = Fixture::new();
        f.write_file("a.md", "# a\n");
        let result = f.backend().sync(None).unwrap();
        assert!(result.completed_unix > 0);
    }

    #[test]
    fn map_remote_error_classifies_network_and_auth_errors() {
        // `git2::Error::new` takes (code, class, message), so we can
        // hand the mapper every branch's class and confirm it routes
        // to the matching `SyncError` variant.
        use git2::{ErrorClass, ErrorCode};

        let net = git2::Error::new(ErrorCode::GenericError, ErrorClass::Net, "down");
        assert!(matches!(map_remote_error(net), SyncError::Network(_)));

        let http = git2::Error::new(ErrorCode::GenericError, ErrorClass::Http, "500");
        assert!(matches!(map_remote_error(http), SyncError::Network(_)));

        let ssh = git2::Error::new(ErrorCode::GenericError, ErrorClass::Ssh, "no key");
        assert!(matches!(map_remote_error(ssh), SyncError::AuthFailed(_)));

        let cb = git2::Error::new(ErrorCode::GenericError, ErrorClass::Callback, "rejected");
        assert!(matches!(map_remote_error(cb), SyncError::AuthFailed(_)));

        // Unclassified errors whose message mentions auth/authentication
        // still route to AuthFailed.
        let phrased = git2::Error::from_str("authentication required");
        assert!(matches!(
            map_remote_error(phrased),
            SyncError::AuthFailed(_)
        ));

        // Everything else falls through to Backend.
        let generic = git2::Error::from_str("something else");
        assert!(matches!(map_remote_error(generic), SyncError::Backend(_)));
    }

    #[test]
    fn init_repo_creates_a_repository_with_the_requested_default_branch() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "trunk").unwrap();
        let repo = Repository::open(tmp.path()).unwrap();
        // HEAD points at refs/heads/trunk on a fresh repo even before
        // the first commit.
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target(), Some("refs/heads/trunk"));
    }

    #[test]
    fn clone_repo_clones_an_unauthenticated_local_remote() {
        // Seed: build a working repo, push a file, then clone the bare
        // remote into a fresh path. The clone should contain the file.
        let f = Fixture::new();
        f.write_file("seed.md", "# seed\n");
        f.backend().sync(None).unwrap();

        let dest = f._tmp.path().join("cloned");
        let resolved = clone_repo(f.remote.to_str().unwrap(), &dest, None).unwrap();
        assert_eq!(resolved, dest);
        assert!(dest.join("seed.md").exists());
        assert!(dest.join(".git").exists());
    }

    #[test]
    fn clone_repo_errors_when_target_exists_and_is_not_empty() {
        let f = Fixture::new();
        f.write_file("seed.md", "# seed\n");
        f.backend().sync(None).unwrap();

        // libgit2 refuses to clone into a non-empty directory.
        let dest = f._tmp.path().join("existing");
        fs::create_dir_all(&dest).unwrap();
        fs::write(dest.join("blocker.txt"), "x").unwrap();
        let err = clone_repo(f.remote.to_str().unwrap(), &dest, None).unwrap_err();
        // Local-path bare remotes go through libgit2 directly without
        // hitting the network classifier; we just confirm it failed
        // with some backend-mapped error.
        assert!(
            matches!(err, SyncError::Backend(_) | SyncError::Network(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn set_origin_creates_then_updates_the_remote_url() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), super::super::DEFAULT_REMOTE_BRANCH).unwrap();
        set_origin(tmp.path(), "https://example.com/a.git").unwrap();
        set_origin(tmp.path(), "https://example.com/b.git").unwrap();
        let repo = Repository::open(tmp.path()).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://example.com/b.git"));
    }

    #[test]
    fn signature_falls_back_to_global_config_when_no_author_in_workspace_config() {
        let f = Fixture::new();
        let mut backend = f.backend();
        backend.config.author = None;
        let sig = backend.signature().unwrap();
        assert!(!sig.name().unwrap().is_empty());
        assert!(!sig.email().unwrap().is_empty());
    }

    #[test]
    fn sync_merges_non_conflicting_remote_changes() {
        // Two clones change *different* files starting from the same
        // commit. The fetch sees a remote that's not a fast-forward
        // (both sides committed on top of the common ancestor), but the
        // merge has no conflicts so libgit2 writes a merge commit, then
        // we push.
        let f = Fixture::new();
        f.write_file("base.md", "base\n");
        f.backend().sync(None).unwrap();

        let other = f._tmp.path().join("other");
        Repository::clone(f.remote.to_str().unwrap(), &other).unwrap();
        let mut other_cfg = WorkspaceSyncConfig::new_git(other.to_string_lossy());
        other_cfg.remote_url = f.remote.to_string_lossy().into();
        other_cfg.author = Some(super::super::config::CommitIdentity {
            name: "Other".into(),
            email: "o@e.com".into(),
        });
        fs::write(other.join("other-only.md"), "from other\n").unwrap();
        GitBackend::new(other_cfg).sync(None).unwrap();

        // Now the first workspace edits a different file and syncs.
        f.write_file("first-only.md", "from first\n");
        let result = f.backend().sync(None).unwrap();
        assert!(result.conflicts.is_empty(), "no conflicts expected");
        assert_eq!(result.pulled_count, 1, "merged in other's commit");
        assert!(result.pushed_count >= 1, "merge commit pushed");
        // After the merge both files exist locally.
        assert!(f.workspace.join("first-only.md").exists());
        assert!(f.workspace.join("other-only.md").exists());
    }

    #[test]
    fn sync_surfaces_conflicts_and_does_not_push() {
        // Two clones diverge on the same file → second sync hits a
        // merge conflict.
        let f = Fixture::new();
        f.write_file("notes.md", "line one\nline two\n");
        f.backend().sync(None).unwrap();

        // Second clone, edits the same line.
        let other = f._tmp.path().join("other");
        Repository::clone(f.remote.to_str().unwrap(), &other).unwrap();
        let mut other_cfg = WorkspaceSyncConfig::new_git(other.to_string_lossy());
        other_cfg.remote_url = f.remote.to_string_lossy().into();
        other_cfg.author = Some(super::super::config::CommitIdentity {
            name: "Other".into(),
            email: "o@e.com".into(),
        });
        let other_backend = GitBackend::new(other_cfg);
        fs::write(other.join("notes.md"), "line one\nFROM OTHER\n").unwrap();
        other_backend.sync(None).unwrap();

        // First workspace edits the same file too, then tries to sync.
        f.write_file("notes.md", "line one\nFROM FIRST\n");
        let result = f.backend().sync(None).unwrap();
        assert!(
            !result.conflicts.is_empty(),
            "expected conflicts, got {result:?}"
        );
        assert!(result.conflicts.iter().any(|p| p.ends_with("notes.md")));
        assert_eq!(result.pushed_count, 0, "must not push while conflicted");
    }

    #[test]
    fn sync_refuses_to_run_while_workspace_still_has_unresolved_conflicts() {
        // Same setup as above, but call sync twice in a row without
        // resolving the conflict — second call should error out instead
        // of trying to "merge again".
        let f = Fixture::new();
        f.write_file("notes.md", "line one\n");
        f.backend().sync(None).unwrap();

        let other = f._tmp.path().join("other");
        Repository::clone(f.remote.to_str().unwrap(), &other).unwrap();
        let mut other_cfg = WorkspaceSyncConfig::new_git(other.to_string_lossy());
        other_cfg.remote_url = f.remote.to_string_lossy().into();
        other_cfg.author = Some(super::super::config::CommitIdentity {
            name: "Other".into(),
            email: "o@e.com".into(),
        });
        fs::write(other.join("notes.md"), "OTHER\n").unwrap();
        GitBackend::new(other_cfg).sync(None).unwrap();

        f.write_file("notes.md", "MINE\n");
        f.backend().sync(None).unwrap(); // leaves conflict in index
        let err = f.backend().sync(None).unwrap_err();
        assert!(matches!(err, SyncError::Conflict(_)), "got {err:?}");
    }

    // -- auto_commit_message ------------------------------------------------
    //
    // Helpers for the GitHub-style auto-commit message generator. Each
    // test stages a known diff into a fresh repo via `stage_all` and
    // then asks `auto_commit_message` to summarise it.

    /// Open the workspace repo for a fixture and stage everything,
    /// returning the message `auto_commit_message` would produce.
    fn auto_message_for(f: &Fixture) -> String {
        let repo = Repository::open(&f.workspace).unwrap();
        GitBackend::stage_all(&repo).unwrap();
        auto_commit_message(&repo).unwrap()
    }

    #[test]
    fn auto_commit_message_for_a_single_added_file_says_create() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        assert_eq!(auto_message_for(&f), "Create notes.md");
    }

    #[test]
    fn auto_commit_message_on_unborn_branch_treats_paths_as_added() {
        // No HEAD yet — the diff source is `None`, so libgit2 marks
        // every index entry as `Added`. Two new files: "Create a, b".
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path();
        init_repo(workspace, super::super::DEFAULT_REMOTE_BRANCH).unwrap();
        fs::write(workspace.join("a.md"), "a").unwrap();
        fs::write(workspace.join("b.md"), "b").unwrap();
        let repo = Repository::open(workspace).unwrap();
        GitBackend::stage_all(&repo).unwrap();
        assert_eq!(auto_commit_message(&repo).unwrap(), "Create a.md, b.md");
    }

    #[test]
    fn auto_commit_message_for_a_single_deleted_file_says_delete() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        f.backend().sync(None).unwrap();
        fs::remove_file(f.workspace.join("notes.md")).unwrap();
        assert_eq!(auto_message_for(&f), "Delete notes.md");
    }

    #[test]
    fn auto_commit_message_for_a_single_modified_file_says_update() {
        let f = Fixture::new();
        f.write_file("notes.md", "# hi\n");
        f.backend().sync(None).unwrap();
        f.write_file("notes.md", "# changed\n");
        assert_eq!(auto_message_for(&f), "Update notes.md");
    }

    #[test]
    fn auto_commit_message_for_two_mixed_deltas_uses_update_with_a_comma() {
        // One add + one modify on top of a clean repo. Mixed kinds, so
        // the verb falls back to "Update".
        let f = Fixture::new();
        f.write_file("a.md", "a\n");
        f.backend().sync(None).unwrap();
        f.write_file("a.md", "changed\n");
        f.write_file("b.md", "b\n");
        let msg = auto_message_for(&f);
        // Order of deltas isn't part of the API contract.
        assert!(
            msg == "Update a.md, b.md" || msg == "Update b.md, a.md",
            "unexpected message: {msg}"
        );
    }

    #[test]
    fn auto_commit_message_for_three_added_files_lists_each_with_create() {
        let f = Fixture::new();
        f.write_file("seed.md", "seed\n");
        f.backend().sync(None).unwrap();
        f.write_file("a.md", "a\n");
        f.write_file("b.md", "b\n");
        f.write_file("c.md", "c\n");
        let msg = auto_message_for(&f);
        assert!(msg.starts_with("Create "), "got: {msg}");
        for name in ["a.md", "b.md", "c.md"] {
            assert!(msg.contains(name), "missing {name} in {msg}");
        }
    }

    #[test]
    fn auto_commit_message_for_four_plus_files_collapses_into_n_more() {
        let f = Fixture::new();
        f.write_file("seed.md", "seed\n");
        f.backend().sync(None).unwrap();
        for n in ["a.md", "b.md", "c.md", "d.md", "e.md"] {
            fs::write(f.workspace.join(n), "x\n").unwrap();
        }
        let msg = auto_message_for(&f);
        assert!(msg.starts_with("Create "), "got: {msg}");
        assert!(msg.contains(" and 3 more files"), "got: {msg}");
    }
}
