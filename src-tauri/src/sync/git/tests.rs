use super::test_support::Fixture;
use super::*;
use crate::sync::{BackendKind, SyncBackend, WorkspaceSyncConfig};
use git2::Repository;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

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
///
/// The raw type is libgit2's C `int` enum: the git2 binding surfaces it
/// as `u32` on Unix but `i32` on Windows MSVC. Widen both operands to
/// `i64` (a type neither already is, so clippy doesn't flag a redundant
/// cast on either platform) before the bit-AND to keep the helper
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
fn sync_commits_locally_when_no_remote_is_configured() {
    // Sync enabled but no remote URL: the backend still stages and commits
    // into local history, reporting nothing pushed or pulled, so the user
    // gets versioned snapshots they can attach a remote to later.
    let tmp = TempDir::new().unwrap();
    let workspace = tmp.path().join("local-only");
    fs::create_dir_all(&workspace).unwrap();
    init_repo(&workspace, super::super::DEFAULT_REMOTE_BRANCH).unwrap();
    let cfg_path = workspace.join(".git/config");
    let mut gitcfg = git2::Config::open(&cfg_path).unwrap();
    gitcfg.set_str("user.name", "Test User").unwrap();
    gitcfg.set_str("user.email", "test@example.com").unwrap();

    // remote_url stays empty => local-only.
    let mut cfg = WorkspaceSyncConfig::new_git(workspace.to_string_lossy());
    cfg.author = Some(super::super::config::CommitIdentity {
        name: "Test User".into(),
        email: "test@example.com".into(),
    });
    let backend = GitBackend::new(cfg);

    fs::write(workspace.join("notes.md"), "# hi\n").unwrap();
    let result = backend.sync(None).unwrap();
    assert_eq!(result.committed_count, 1);
    assert_eq!(result.pushed_count, 0);
    assert_eq!(result.pulled_count, 0);
    assert!(result.conflicts.is_empty());

    // The commit landed in local history...
    let repo = Repository::open(&workspace).unwrap();
    let head = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(head.message().unwrap(), "Create notes.md");

    // ...and the working tree reads clean afterwards, with no remote to be
    // ahead of or behind.
    let status = backend.status().unwrap();
    assert!(status.clean);
    assert_eq!(status.ahead, 0);
    assert_eq!(status.behind, 0);
}

#[test]
fn commit_config_commits_glyph_dir_once_then_is_a_noop() {
    // Simulate enabling sync on a repo that already has history (so the
    // setup commit gets a parent), then write a `.glyph/` config and commit it.
    let f = Fixture::new();
    f.write_file("seed.md", "# seed\n");
    f.backend().sync(None).unwrap();
    let glyph = f.workspace.join(".glyph");
    fs::create_dir_all(&glyph).unwrap();
    fs::write(glyph.join("config.json"), "{\"version\":1}\n").unwrap();
    fs::write(glyph.join(".gitignore"), "state.json\n").unwrap();
    // A volatile state file that must NOT be committed (it's gitignored).
    fs::write(glyph.join("state.json"), "{}\n").unwrap();

    let backend = f.backend();
    assert!(backend.commit_config().unwrap(), "first call commits");

    // The commit contains the config + gitignore but not state.json.
    let repo = Repository::open(&f.workspace).unwrap();
    let tree = repo.head().unwrap().peel_to_tree().unwrap();
    assert!(tree
        .get_path(std::path::Path::new(".glyph/config.json"))
        .is_ok());
    assert!(tree
        .get_path(std::path::Path::new(".glyph/.gitignore"))
        .is_ok());
    assert!(tree
        .get_path(std::path::Path::new(".glyph/state.json"))
        .is_err());
    let tip = repo.head().unwrap().peel_to_commit().unwrap();
    assert_eq!(tip.message().unwrap(), super::config_commit_message());

    // Second call is a no-op: `.glyph/` is already tracked.
    assert!(
        !backend.commit_config().unwrap(),
        "second call commits nothing"
    );
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
fn sync_merges_when_local_and_remote_have_diverged() {
    // Seed a shared base, then let each copy commit a *different* file
    // without pulling first. The second sync can neither no-op nor
    // fast-forward, so it takes the true-merge branch and writes a
    // merge commit (the `commit_index` call the other paths skip).
    let f = Fixture::new();
    f.write_file("seed.md", "# seed\n");
    f.backend().sync(None).unwrap();

    // Second working copy off the same remote, sharing the seed commit.
    let other = f._tmp.path().join("other");
    Repository::clone(f.remote.to_str().unwrap(), &other).unwrap();
    let mut other_cfg = WorkspaceSyncConfig::new_git(other.to_string_lossy());
    other_cfg.remote_url = f.remote.to_string_lossy().into();
    other_cfg.author = Some(super::super::config::CommitIdentity {
        name: "Other User".into(),
        email: "other@example.com".into(),
    });
    let other_backend = GitBackend::new(other_cfg);

    // A advances the remote with a.md.
    f.write_file("a.md", "# a\n");
    f.backend().sync(None).unwrap();

    // B commits a different, non-conflicting file without pulling, so
    // its branch has diverged from the remote (each side owns one
    // unique commit on top of the shared seed).
    fs::write(other.join("b.md"), "# b\n").unwrap();
    let result = other_backend.sync(None).unwrap();

    // True merge: B pulls A's commit, writes a conflict-free merge
    // commit, and pushes the result. Both files survive.
    assert_eq!(result.pulled_count, 1);
    assert!(result.conflicts.is_empty());
    assert!(other.join("a.md").exists());
    assert!(other.join("b.md").exists());

    // The remote tip is now the merge commit: two parents, and the
    // dedicated merge message rather than an auto-generated subject.
    let remote = Repository::open_bare(&f.remote).unwrap();
    let tip = remote
        .find_reference("refs/heads/main")
        .unwrap()
        .peel_to_commit()
        .unwrap();
    assert_eq!(tip.parent_count(), 2);
    assert_eq!(tip.message().unwrap(), merge_commit_message().as_str());
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
