//! Pure async operations the Tauri commands forward to.
//!
//! Each `#[tauri::command]` in [`super::commands`] is a one-liner that
//! calls a helper from this module. Splitting them out lets us drive the
//! full sync surface from `#[tokio::test]` against a plain `&SyncState`
//! without needing a Tauri runtime, and it lets `commands.rs` stay a
//! thin IPC adapter that codecov ignores (the `#[tauri::command]`
//! macro emits IPC marshalling code that isn't reachable from direct
//! function calls, so coverage there is misleading).

use std::path::PathBuf;

use super::backend::{StatusReport, SyncResult};
use super::config::{CommitAuthorHint, WorkspaceSyncConfig};
use super::error::SyncError;
use super::git;
use super::state::SyncState;
use super::DEFAULT_REMOTE_BRANCH;

/// Persist (or replace) the sync config for the workspace it names.
pub fn set_config(state: &SyncState, config: WorkspaceSyncConfig) {
    state.set_config(config);
}

/// Look up the stored config for a workspace. `None` is a clean "not
/// configured yet" signal, distinct from an error.
pub fn get_config(state: &SyncState, workspace_path: &str) -> Option<WorkspaceSyncConfig> {
    state.get_config(workspace_path)
}

/// Forget a workspace's config (e.g. user disabled sync for it).
pub fn remove_config(state: &SyncState, workspace_path: &str) {
    state.remove_config(workspace_path);
}

/// Stash a credential token in memory for `workspace_path`. The OS-keychain
/// PR replaces this implementation; the call signature stays the same.
pub fn set_token(state: &SyncState, workspace_path: String, token: String) {
    state.set_token(workspace_path, token);
}

/// Drop the in-memory token for a workspace.
pub fn clear_token(state: &SyncState, workspace_path: &str) {
    state.clear_token(workspace_path);
}

/// Initialise a fresh repository at `workspace_path` with `default_branch`
/// as HEAD. Sets `origin` to `remote_url` when one is supplied so the
/// follow-up `run_sync` call can push to it.
pub async fn init_repo(
    workspace_path: String,
    default_branch: Option<String>,
    remote_url: Option<String>,
) -> Result<(), SyncError> {
    tauri::async_runtime::spawn_blocking(move || {
        let branch = default_branch.unwrap_or_else(|| DEFAULT_REMOTE_BRANCH.to_string());
        let path = PathBuf::from(&workspace_path);
        git::init_repo(&path, &branch)?;
        if let Some(url) = remote_url {
            git::set_origin(&path, &url)?;
        }
        Ok(())
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Clone `remote_url` into `workspace_path`. Destination must not exist
/// yet (libgit2 rule). When `token` is provided it's used as HTTPS
/// basic-auth.
pub async fn clone_remote(
    workspace_path: String,
    remote_url: String,
    token: Option<String>,
) -> Result<(), SyncError> {
    tauri::async_runtime::spawn_blocking(move || {
        git::clone_repo(
            &remote_url,
            &PathBuf::from(&workspace_path),
            token.as_deref(),
        )
        .map(|_| ())
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Write the remote URL into `<workspace>/.git/config` under
/// `[remote "origin"]`. The Save flow in the modal calls this so that
/// when the user edits the Remote URL field on an existing repo, the
/// next fetch/push actually uses the new value instead of whatever the
/// existing `.git/config` happens to carry.
pub async fn set_origin(workspace_path: String, remote_url: String) -> Result<(), SyncError> {
    tauri::async_runtime::spawn_blocking(move || {
        git::set_origin(&PathBuf::from(&workspace_path), &remote_url)
    })
    .await
    .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Inspect git's config for a default `user.name` and `user.email` to
/// suggest in the Cloud Sync setup form. Tries the workspace-level
/// `<path>/.git/config` first (so a per-repo identity wins over the
/// machine-global one), then falls back to libgit2's default chain
/// (`$XDG_CONFIG_HOME/git/config`, `~/.gitconfig`, `/etc/gitconfig`).
///
/// Each field is independently optional and a missing value is *not*
/// an error: the frontend just shows a generic placeholder.
pub fn default_author(workspace_path: &str) -> CommitAuthorHint {
    let workspace_cfg_path = PathBuf::from(workspace_path).join(".git/config");
    let mut hint = CommitAuthorHint::default();

    if let Ok(cfg) = git2::Config::open(&workspace_cfg_path) {
        hint.name = cfg.get_string("user.name").ok().filter(|s| !s.is_empty());
        hint.email = cfg.get_string("user.email").ok().filter(|s| !s.is_empty());
    }

    if hint.name.is_some() && hint.email.is_some() {
        return hint;
    }

    if let Ok(cfg) = git2::Config::open_default() {
        if hint.name.is_none() {
            hint.name = cfg.get_string("user.name").ok().filter(|s| !s.is_empty());
        }
        if hint.email.is_none() {
            hint.email = cfg.get_string("user.email").ok().filter(|s| !s.is_empty());
        }
    }

    hint
}

/// True when `workspace_path` is already a git repository. Used by the
/// Cloud Sync modal to decide whether to show the "Initialize repo"
/// banner. Anything that prevents libgit2 from opening the repo
/// (missing folder, no `.git` dir, corrupt refs) collapses to `false`.
pub fn repo_present(workspace_path: &str) -> bool {
    git2::Repository::open(workspace_path).is_ok()
}

/// Build the configured backend for `workspace_path` and ask it for its
/// status. Errors with `NotConfigured` when no config has been stored
/// yet — the frontend interprets that as "show the setup CTA".
pub async fn run_status(
    state: &SyncState,
    workspace_path: &str,
) -> Result<StatusReport, SyncError> {
    let backend = state.build_backend(workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || backend.status())
        .await
        .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

/// Build the configured backend and run a full sync (stage, commit,
/// fetch, merge, push). Conflicts come back via `SyncResult.conflicts`,
/// not as an error: the frontend opens the conflict UI for those.
///
/// `message` is the optional commit subject for the auto-commit step.
/// `None` (or a string that trims to empty inside the backend) asks the
/// backend to generate a GitHub-style subject from the staged diff.
pub async fn run_sync(
    state: &SyncState,
    workspace_path: &str,
    message: Option<String>,
) -> Result<SyncResult, SyncError> {
    let backend = state.build_backend(workspace_path)?;
    tauri::async_runtime::spawn_blocking(move || backend.sync(message.as_deref()))
        .await
        .map_err(|e| SyncError::Backend(format!("task join error: {e}")))?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::backend::{BackendKind, ConflictPolicy};
    use crate::sync::config::CommitIdentity;
    use std::fs;
    use tempfile::TempDir;

    /// Mirror of `sync::git::tests::Fixture` so the ops tests have a
    /// real bare-repo backend to drive without depending on internals.
    pub(super) struct Workspace {
        pub tmp: TempDir,
        pub workspace_path: String,
        pub remote_path: String,
    }

    impl Workspace {
        pub fn new() -> Self {
            let tmp = TempDir::new().unwrap();
            let remote = tmp.path().join("remote.git");
            let mut opts = git2::RepositoryInitOptions::new();
            opts.bare(true);
            opts.initial_head(DEFAULT_REMOTE_BRANCH);
            git2::Repository::init_opts(&remote, &opts).unwrap();
            Self {
                workspace_path: tmp.path().join("local").to_string_lossy().into(),
                remote_path: remote.to_string_lossy().into(),
                tmp,
            }
        }

        pub fn config(&self) -> WorkspaceSyncConfig {
            WorkspaceSyncConfig {
                workspace_path: self.workspace_path.clone(),
                backend: BackendKind::Git,
                remote_url: self.remote_path.clone(),
                remote_branch: DEFAULT_REMOTE_BRANCH.to_string(),
                conflict_policy: ConflictPolicy::Prompt,
                auto_sync_seconds: None,
                author: Some(CommitIdentity {
                    name: "Test User".into(),
                    email: "test@example.com".into(),
                }),
            }
        }
    }

    #[tokio::test]
    async fn init_repo_creates_a_repo_with_origin_set() {
        let ws = Workspace::new();
        init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();

        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some(ws.remote_path.as_str()));
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(
            head.symbolic_target(),
            Some(format!("refs/heads/{DEFAULT_REMOTE_BRANCH}").as_str())
        );
    }

    #[tokio::test]
    async fn init_repo_respects_an_explicit_default_branch() {
        let ws = Workspace::new();
        init_repo(ws.workspace_path.clone(), Some("trunk".into()), None)
            .await
            .unwrap();
        let repo = git2::Repository::open(&ws.workspace_path).unwrap();
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target(), Some("refs/heads/trunk"));
    }

    #[tokio::test]
    async fn run_status_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_status(&state, &ws.workspace_path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_sync_errors_when_no_config_is_set() {
        let ws = Workspace::new();
        let state = SyncState::new();
        let err = run_sync(&state, &ws.workspace_path, None)
            .await
            .unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn run_status_errors_when_config_set_but_repo_is_missing() {
        let tmp = TempDir::new().unwrap();
        let state = SyncState::new();
        let config = WorkspaceSyncConfig {
            workspace_path: tmp.path().to_string_lossy().into(),
            backend: BackendKind::Git,
            remote_url: String::new(),
            remote_branch: DEFAULT_REMOTE_BRANCH.into(),
            conflict_policy: ConflictPolicy::Prompt,
            auto_sync_seconds: None,
            author: None,
        };
        let path = config.workspace_path.clone();
        set_config(&state, config);
        let err = run_status(&state, &path).await.unwrap_err();
        assert!(matches!(err, SyncError::NotConfigured));
    }

    #[tokio::test]
    async fn full_init_then_sync_round_trip() {
        let ws = Workspace::new();
        let state = SyncState::new();

        init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();

        fs::write(
            std::path::Path::new(&ws.workspace_path).join("notes.md"),
            "# hello\n",
        )
        .unwrap();

        set_config(&state, ws.config());

        let result = run_sync(&state, &ws.workspace_path, None).await.unwrap();
        assert_eq!(result.kind, BackendKind::Git);
        assert_eq!(result.committed_count, 1);
        assert_eq!(result.pushed_count, 1);
        assert!(result.conflicts.is_empty());

        let status = run_status(&state, &ws.workspace_path).await.unwrap();
        assert!(status.clean);
        assert_eq!(status.ahead, 0);
        assert_eq!(status.behind, 0);
    }

    #[tokio::test]
    async fn clone_remote_populates_a_fresh_workspace_from_the_remote() {
        let ws = Workspace::new();
        init_repo(
            ws.workspace_path.clone(),
            None,
            Some(ws.remote_path.clone()),
        )
        .await
        .unwrap();
        fs::write(
            std::path::Path::new(&ws.workspace_path).join("seed.md"),
            "# seed\n",
        )
        .unwrap();
        let state = SyncState::new();
        set_config(&state, ws.config());
        run_sync(&state, &ws.workspace_path, None).await.unwrap();

        let dest = ws.tmp.path().join("clone-into-me");
        clone_remote(dest.to_string_lossy().into(), ws.remote_path.clone(), None)
            .await
            .unwrap();
        assert!(dest.join("seed.md").exists());
    }

    #[tokio::test]
    async fn config_set_then_get_round_trips_through_the_command_helpers() {
        let ws = Workspace::new();
        let state = SyncState::new();
        assert!(get_config(&state, &ws.workspace_path).is_none());
        set_config(&state, ws.config());
        let cfg = get_config(&state, &ws.workspace_path).unwrap();
        assert_eq!(cfg.workspace_path, ws.workspace_path);
        assert_eq!(cfg.backend, BackendKind::Git);
        remove_config(&state, &ws.workspace_path);
        assert!(get_config(&state, &ws.workspace_path).is_none());
    }

    #[tokio::test]
    async fn token_set_clear_round_trip() {
        let state = SyncState::new();
        set_token(&state, "/ws".into(), "tok".into());
        assert_eq!(state.get_token("/ws").as_deref(), Some("tok"));
        clear_token(&state, "/ws");
        assert!(state.get_token("/ws").is_none());
    }

    #[test]
    fn repo_present_is_false_for_an_empty_directory() {
        let tmp = TempDir::new().unwrap();
        assert!(!repo_present(&tmp.path().to_string_lossy()));
    }

    #[test]
    fn repo_present_is_true_after_git_init() {
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        assert!(repo_present(&tmp.path().to_string_lossy()));
    }

    #[test]
    fn default_author_reads_workspace_level_user_name_and_email() {
        // Build a repo so `<workspace>/.git/config` exists, then write
        // both fields directly to that config. `git2::Config::open` on a
        // single file gives us a deterministic, isolated config that
        // doesn't depend on the host's `~/.gitconfig`.
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let cfg_path = tmp.path().join(".git/config");
        let mut cfg = git2::Config::open(&cfg_path).unwrap();
        cfg.set_str("user.name", "Workspace Author").unwrap();
        cfg.set_str("user.email", "ws@example.com").unwrap();

        let hint = default_author(&tmp.path().to_string_lossy());
        assert_eq!(hint.name.as_deref(), Some("Workspace Author"));
        assert_eq!(hint.email.as_deref(), Some("ws@example.com"));
    }

    #[test]
    fn default_author_returns_a_hint_for_a_directory_without_a_repo() {
        // No `.git/config` available: we still get a hint, just one with
        // whatever the host's global git config happens to carry (which
        // we can't pin in a unit test). The contract is "no panic, no
        // error" -- both fields are `Option<String>` and the call must
        // succeed regardless of what's on disk.
        let tmp = TempDir::new().unwrap();
        let _hint = default_author(&tmp.path().to_string_lossy());
    }

    #[tokio::test]
    async fn set_origin_writes_remote_origin_into_the_workspace_git_config() {
        // Initialise a plain workspace via `git2::Repository::init` (no
        // remote configured), then drive `ops::set_origin`. The remote
        // should land under `[remote "origin"]` in `.git/config`.
        let tmp = TempDir::new().unwrap();
        let workspace = tmp.path().to_string_lossy().to_string();
        git2::Repository::init(tmp.path()).unwrap();

        set_origin(workspace.clone(), "https://example.com/a.git".into())
            .await
            .unwrap();
        let repo = git2::Repository::open(tmp.path()).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://example.com/a.git"));

        // A second call updates the URL in place rather than erroring on
        // a duplicate remote (covers the `Ok(_) -> remote_set_url` arm).
        set_origin(workspace, "https://example.com/b.git".into())
            .await
            .unwrap();
        let repo = git2::Repository::open(tmp.path()).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url(), Some("https://example.com/b.git"));
    }

    #[test]
    fn default_author_reads_workspace_user_config_when_repo_present() {
        // Mirror of the same test in `git::tests`: write a per-repo
        // `[user]` section into the workspace's `.git/config` and confirm
        // `default_author` surfaces both fields. Worth the duplication
        // because `ops::default_author` is the actual code path the Tauri
        // command goes through, and it has its own fallback chain on top.
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let cfg_path = tmp.path().join(".git/config");
        let mut cfg = git2::Config::open(&cfg_path).unwrap();
        cfg.set_str("user.name", "Workspace Author").unwrap();
        cfg.set_str("user.email", "ws@example.com").unwrap();

        let hint = default_author(&tmp.path().to_string_lossy());
        assert_eq!(hint.name.as_deref(), Some("Workspace Author"));
        assert_eq!(hint.email.as_deref(), Some("ws@example.com"));
    }

    /// Serialises every test that touches libgit2's process-wide search
    /// paths via `git2::opts::set_search_path`. Without this lock two
    /// parallel tests would race to install their override and either
    /// see the wrong global config or restore the host's path on top of
    /// the other test's in-flight assertions.
    fn search_path_guard() -> std::sync::MutexGuard<'static, ()> {
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        LOCK.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// RAII helper: redirect libgit2's `Global` (and `Xdg` + `System`)
    /// search path to a directory we control for the test and restore
    /// the original paths on drop. Saves/restores via
    /// `git2::opts::get_search_path` so the host's `.gitconfig`
    /// lookup keeps working after the test finishes.
    struct SearchPathOverride {
        previous: Vec<(git2::ConfigLevel, std::ffi::CString)>,
    }

    impl SearchPathOverride {
        fn install(dir: &std::path::Path) -> Self {
            let levels = [
                git2::ConfigLevel::Global,
                git2::ConfigLevel::XDG,
                git2::ConfigLevel::System,
            ];
            let mut previous = Vec::with_capacity(levels.len());
            for level in levels {
                // SAFETY: globally locked by `search_path_guard`. The
                // pointer returned by `get_search_path` is copied into
                // the owned CString before we mutate.
                let prev = unsafe { git2::opts::get_search_path(level) }.unwrap_or_default();
                previous.push((level, prev));
                // SAFETY: same lock; `dir` outlives the call.
                unsafe {
                    git2::opts::set_search_path(level, dir.to_str().unwrap()).unwrap();
                }
            }
            Self { previous }
        }
    }

    impl Drop for SearchPathOverride {
        fn drop(&mut self) {
            for (level, prev) in &self.previous {
                let s = prev.to_string_lossy().into_owned();
                // SAFETY: still holding the search_path_guard lock for
                // the duration of the test that owns this Drop.
                unsafe {
                    git2::opts::set_search_path(*level, s.as_str()).ok();
                }
            }
        }
    }

    #[test]
    fn default_author_falls_back_to_global_config_when_workspace_is_missing_a_field() {
        // Drives the workspace-then-global merge: workspace knows the name
        // only, global supplies the email. Covers the inner `is_none()`
        // arms (lines 123-128) and the closing braces around them
        // (lines 125, 128, 129).
        let _g = search_path_guard();
        let tmp = TempDir::new().unwrap();

        // Workspace config: name set, email missing.
        git2::Repository::init(tmp.path()).unwrap();
        let workspace_cfg_path = tmp.path().join(".git/config");
        let mut workspace_cfg = git2::Config::open(&workspace_cfg_path).unwrap();
        workspace_cfg
            .set_str("user.name", "Workspace Only")
            .unwrap();

        // Global config (libgit2 looks for `.gitconfig` in the dir we
        // pointed `Global` at): email set, name absent.
        let fake_home = tmp.path().join("fake-home");
        std::fs::create_dir_all(&fake_home).unwrap();
        std::fs::write(
            fake_home.join(".gitconfig"),
            "[user]\n\temail = global@example.com\n",
        )
        .unwrap();
        let _override = SearchPathOverride::install(&fake_home);

        let hint = default_author(&tmp.path().to_string_lossy());
        assert_eq!(hint.name.as_deref(), Some("Workspace Only"));
        assert_eq!(hint.email.as_deref(), Some("global@example.com"));
    }

    #[test]
    fn default_author_skips_workspace_config_when_it_cannot_be_opened() {
        // `<ws>/.git/config` exists but is a *directory*, so
        // `git2::Config::open` returns Err and `default_author` falls
        // through to the global lookup instead of reading the workspace
        // file. Exercises the Err arm of the workspace-config branch and
        // re-enters the global-config block with an empty redirect.
        let _g = search_path_guard();
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".git/config")).unwrap();

        // Point the global lookup at an empty `.gitconfig` so the result is
        // deterministic regardless of the host's real git identity.
        let fake_home = tmp.path().join("fake-home");
        std::fs::create_dir_all(&fake_home).unwrap();
        std::fs::write(fake_home.join(".gitconfig"), "").unwrap();
        let _override = SearchPathOverride::install(&fake_home);

        let hint = default_author(&tmp.path().to_string_lossy());
        assert_eq!(hint.name, None);
        assert_eq!(hint.email, None);
    }

    #[test]
    fn default_author_returns_only_workspace_email_when_global_is_empty() {
        // Workspace supplies email only; the redirected global config has
        // nothing. Email comes through from the workspace, name stays None.
        // Hits the lines 123-125 `is_none()` arm with the inner lookup
        // returning None on line 124.
        let _g = search_path_guard();
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let workspace_cfg_path = tmp.path().join(".git/config");
        let mut workspace_cfg = git2::Config::open(&workspace_cfg_path).unwrap();
        workspace_cfg
            .set_str("user.email", "ws@example.com")
            .unwrap();

        let fake_home = tmp.path().join("fake-home");
        std::fs::create_dir_all(&fake_home).unwrap();
        std::fs::write(fake_home.join(".gitconfig"), "").unwrap();
        let _override = SearchPathOverride::install(&fake_home);

        let hint = default_author(&tmp.path().to_string_lossy());
        assert_eq!(hint.name, None);
        assert_eq!(hint.email.as_deref(), Some("ws@example.com"));
    }
}
