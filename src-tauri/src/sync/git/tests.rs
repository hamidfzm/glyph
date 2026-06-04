use super::*;
use crate::sync::{BackendKind, SyncBackend, WorkspaceSyncConfig};
use git2::Repository;
use std::fs;
use std::path::PathBuf;
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
///
/// The raw type is libgit2's C `int` enum: the git2 binding surfaces it
/// as `u32` on Unix but `i32` on Windows MSVC. Widen both operands to
/// `i64` (a type neither already is, so clippy doesn't flag a redundant
/// cast on either platform) before the bit-AND to keep the helper
/// portable.
fn cred_has(cred: &git2::Cred, kind: git2::CredentialType) -> bool {
    i64::from(cred.credtype()) & i64::from(kind.bits()) != 0
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
    assert_eq!(tip.message().unwrap(), MERGE_COMMIT_MESSAGE);
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
fn set_origin_errors_when_path_is_not_a_repo() {
    // Covers the `Repository::open(...).map_err(SyncError::Backend)`
    // arm at the top of `set_origin`: a directory that doesn't have
    // a `.git` folder can't be opened, and the error gets surfaced
    // as a Backend variant.
    let tmp = TempDir::new().unwrap();
    let err = set_origin(tmp.path(), "https://example.com/a.git").unwrap_err();
    assert!(matches!(err, SyncError::Backend(_)), "got {err:?}");
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
fn auto_commit_message_falls_back_to_the_legacy_message_when_diff_is_empty() {
    // Defensive fallback path: `auto_commit_message` only runs after
    // `stage_all` flagged "something to commit", but if libgit2 ever
    // reports zero deltas (a clean diff against HEAD) the function
    // must still hand back a usable subject. Re-running it on a fresh
    // post-sync repo with no edits hits that path.
    let f = Fixture::new();
    f.write_file("notes.md", "# hi\n");
    f.backend().sync(None).unwrap();
    let repo = Repository::open(&f.workspace).unwrap();
    // No changes since the sync, so `diff_tree_to_index` is empty.
    let msg = auto_commit_message(&repo).unwrap();
    assert_eq!(msg, super::AUTO_COMMIT_MESSAGE);
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
