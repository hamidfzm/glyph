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
