//! Shared Git fixture for the `sync::git` test modules: a bare `remote/`
//! standing in for the cloud plus a `local/` clone whose working tree the tests
//! mutate. Dropping the returned `TempDir` cleans both up.

use std::fs;
use std::path::PathBuf;

use git2::Repository;
use tempfile::TempDir;

use super::repo::{init_repo, set_origin};
use super::GitBackend;
use crate::sync::{WorkspaceSyncConfig, DEFAULT_REMOTE_BRANCH};

/// Build a self-contained Git test harness:
/// - `remote/` is a bare repository acting as the cloud
/// - `local/` clones from it, with the working tree we'll mutate
/// - returns the [`TempDir`] (drop = cleanup), the workspace path,
///   and a backend wired up to it
pub(super) struct Fixture {
    pub(super) _tmp: TempDir,
    pub(super) workspace: PathBuf,
    pub(super) remote: PathBuf,
}

impl Fixture {
    pub(super) fn new() -> Self {
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
        opts.initial_head(DEFAULT_REMOTE_BRANCH);
        git2::Repository::init_opts(&remote, &opts).unwrap();
        let workspace = tmp.path().join("local");
        fs::create_dir_all(&workspace).unwrap();
        init_repo(&workspace, DEFAULT_REMOTE_BRANCH).unwrap();
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

    pub(super) fn backend(&self) -> GitBackend {
        let mut cfg = WorkspaceSyncConfig::new_git(self.workspace.to_string_lossy());
        cfg.remote_url = self.remote.to_string_lossy().into();
        cfg.author = Some(super::super::config::CommitIdentity {
            name: "Test User".into(),
            email: "test@example.com".into(),
        });
        GitBackend::new(cfg)
    }

    pub(super) fn write_file(&self, name: &str, contents: &str) {
        fs::write(self.workspace.join(name), contents).unwrap();
    }
}
