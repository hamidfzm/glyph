use std::path::{Path, PathBuf};

use git2::{
    BranchType, FetchOptions, MergeOptions, PushOptions, RemoteCallbacks, Repository, StatusOptions,
};

use crate::sync::{
    BackendKind, StatusReport, SyncBackend, SyncError, SyncResult, WorkspaceSyncConfig,
};

use super::{
    auto_commit_message, config_commit_message, make_credentials_callback, map_remote_error,
    merge_commit_message, now_unix, ORIGIN,
};

pub struct GitBackend {
    pub(super) config: WorkspaceSyncConfig,
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

    pub(super) fn signature(&self) -> Result<git2::Signature<'static>, SyncError> {
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
            .unwrap_or_else(|_| format!("{}@localhost", crate::APP_NAME));
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

    /// Whether a remote is configured for this workspace. An empty
    /// `remote_url` means local-only sync: Glyph still stages and commits
    /// changes into the repo's history, but there is nothing to fetch,
    /// merge, or push.
    fn has_remote(&self) -> bool {
        !self.config.remote_url.trim().is_empty()
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

    /// Whether the `.glyph/` config directory is already present in HEAD.
    /// `false` on an unborn branch (no commits yet).
    fn config_tracked(repo: &Repository) -> Result<bool, SyncError> {
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

        // Local-only sync: with no remote configured there is nothing to
        // fetch, merge, or push. The commit above is the whole operation,
        // so the user still gets a real version history they can later
        // attach a remote to.
        if !self.has_remote() {
            return Ok(SyncResult {
                kind: BackendKind::Git,
                pulled_count: 0,
                committed_count,
                pushed_count: 0,
                conflicts: vec![],
                completed_unix: now_unix(),
            });
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
                    .set_target(
                        upstream_oid,
                        &format!("{}: fast-forward to upstream", crate::APP_NAME),
                    )
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
                    &merge_commit_message(),
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

    fn commit_config(&self) -> Result<bool, SyncError> {
        let repo = self.open_repo()?;
        // Only the first enable lands a setup commit; later config edits ride
        // along the next content sync.
        if Self::config_tracked(&repo)? {
            return Ok(false);
        }
        let signature = self.signature()?;
        let mut index = repo
            .index()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        // Stage just the `.glyph/` directory. `.glyph/.gitignore` keeps
        // `state.json` out, so this commits config.json + the .gitignore only.
        index
            .add_all(
                [format!(".{}", crate::APP_NAME).as_str()].iter(),
                git2::IndexAddOption::DEFAULT,
                None,
            )
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        index
            .write()
            .map_err(|e| SyncError::Backend(e.message().to_string()))?;
        let parents = match Self::head_commit(&repo)? {
            Some(c) => vec![c],
            None => vec![],
        };
        Self::commit_index(&repo, &signature, &config_commit_message(), parents)?;
        Ok(true)
    }
}
