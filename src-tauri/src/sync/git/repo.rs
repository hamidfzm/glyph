use std::path::{Path, PathBuf};

use git2::{FetchOptions, RemoteCallbacks, Repository};

use crate::sync::SyncError;

use super::{make_credentials_callback, map_remote_error, ORIGIN};

/// Initialise a new git repository at `path` with the default branch
/// set to the supplied name. Convenience wrapper around `git2::Repository::init_opts`.
pub fn init_repo(path: &Path, default_branch: &str) -> Result<PathBuf, SyncError> {
    let mut opts = git2::RepositoryInitOptions::new();
    opts.initial_head(default_branch);
    Repository::init_opts(path, &opts).map_err(|e| SyncError::Backend(e.message().to_string()))?;
    Ok(path.to_path_buf())
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
    use super::super::test_support::Fixture;
    use super::*;
    use crate::sync::SyncBackend;
    use git2::Repository;
    use std::fs;
    use tempfile::TempDir;
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
        init_repo(tmp.path(), crate::sync::DEFAULT_REMOTE_BRANCH).unwrap();
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
}
