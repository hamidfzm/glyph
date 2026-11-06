use std::path::{Path, PathBuf};

use git2::Repository;

use crate::sync::SyncError;

use super::ORIGIN;

/// Initialise a new git repository at `path` with the default branch
/// set to the supplied name. Convenience wrapper around `git2::Repository::init_opts`.
pub fn init_repo(path: &Path, default_branch: &str) -> Result<PathBuf, SyncError> {
    // The name is written into `.git/HEAD` as given, and the renderer picks it.
    let valid = git2::Branch::name_is_valid(default_branch)
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;
    if !valid {
        return Err(SyncError::Backend("invalid default branch name".into()));
    }
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head(default_branch);
    Repository::init_opts(path, &opts).map_err(|e| SyncError::Backend(e.message().to_string()))?;
    Ok(path.to_path_buf())
}

/// Make checkouts of `path` write every blob as a plain file: no symbolic
/// links (a link from a remote would lead a later write anywhere on disk),
/// and no line-ending conversion from this machine's git config. A
/// `.gitattributes` in the tree can still ask for one.
pub fn pin_checkout_config(path: &Path) -> Result<(), SyncError> {
    let repo = Repository::open(path).map_err(|e| SyncError::Backend(e.message().to_string()))?;
    let mut config = repo
        .config()
        .map_err(|e| SyncError::Backend(e.message().to_string()))?;
    config
        .set_bool("core.symlinks", false)
        .and_then(|()| config.set_bool("core.autocrlf", false))
        .map_err(|e| SyncError::Backend(e.message().to_string()))
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
    use git2::Repository;
    use tempfile::TempDir;

    #[test]
    fn init_repo_creates_a_repository_with_the_requested_default_branch() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), "trunk").unwrap();
        let repo = Repository::open(tmp.path()).unwrap();
        // HEAD points at refs/heads/trunk on a fresh repo even before
        // the first commit.
        let head = repo.find_reference("HEAD").unwrap();
        assert_eq!(head.symbolic_target().unwrap(), Some("refs/heads/trunk"));
    }

    #[test]
    fn init_repo_refuses_a_default_branch_that_is_not_a_reference_name() {
        for name in [
            "",
            "HEAD",
            "-trunk",
            "../../etc/passwd",
            "a b",
            "refs/heads/x..y",
        ] {
            let tmp = TempDir::new().unwrap();
            let err = init_repo(tmp.path(), name).unwrap_err();
            assert!(matches!(err, SyncError::Backend(_)), "{name}: {err:?}");
            assert!(!tmp.path().join(".git").exists(), "{name}");
        }
    }

    #[test]
    fn set_origin_creates_then_updates_the_remote_url() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), crate::sync::DEFAULT_REMOTE_BRANCH).unwrap();
        set_origin(tmp.path(), "https://example.com/a.git").unwrap();
        set_origin(tmp.path(), "https://example.com/b.git").unwrap();
        let repo = Repository::open(tmp.path()).unwrap();
        let remote = repo.find_remote("origin").unwrap();
        assert_eq!(remote.url().unwrap(), "https://example.com/b.git");
    }

    #[test]
    fn pin_checkout_config_turns_off_links_and_line_ending_conversion() {
        let tmp = TempDir::new().unwrap();
        init_repo(tmp.path(), crate::sync::DEFAULT_REMOTE_BRANCH).unwrap();
        pin_checkout_config(tmp.path()).unwrap();
        let config = Repository::open(tmp.path()).unwrap().config().unwrap();
        assert!(!config.get_bool("core.symlinks").unwrap());
        assert!(!config.get_bool("core.autocrlf").unwrap());
        assert!(pin_checkout_config(&tmp.path().join("missing")).is_err());
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
}
