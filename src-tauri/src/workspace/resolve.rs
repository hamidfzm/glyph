//! Workspace resolution for the "one folder = one git repo" rule (#262).
//!
//! A workspace is exactly one git repository's top level. When the user picks
//! a folder we resolve whether it's a git working tree and, if so, whether
//! the selection is that working tree's top level or a nested subdirectory.
//! Nesting (a folder inside a parent `.git`, or inside another workspace's
//! `.glyph/`) makes every workspace-wide feature ambiguous, so the frontend
//! refuses it. A plain non-git folder is a valid workspace.

use std::path::Path;

use serde::Serialize;

/// What the frontend needs to decide whether to adopt a selected folder.
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceResolution {
    /// The folder the user selected (native path string).
    pub selected: String,
    /// Whether `selected` is inside any git working tree.
    pub is_git_repo: bool,
    /// The git working-tree top level, if `is_git_repo` and not bare.
    pub git_top_level: Option<String>,
    /// Set when `selected` is a git repo but NOT its top level (i.e. nested
    /// inside a parent `.git`). The value is that parent top level. This is
    /// the #262 refusal trigger.
    pub nested_under: Option<String>,
    /// Set when an ancestor directory already holds a `.glyph/` (so the
    /// selection would be a workspace nested inside another workspace). The value
    /// is the ancestor that owns the `.glyph/`.
    pub glyph_conflict: Option<String>,
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().to_string()
}

fn canonical(p: &Path) -> std::path::PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
}

/// Walk up from `start`'s parent looking for an ancestor that contains a
/// `.glyph/` directory. The selection owning its own `.glyph/` is fine —
/// only an *ancestor* `.glyph/` signals a nested workspace.
fn ancestor_glyph(start: &Path) -> Option<String> {
    let mut cur = start.parent();
    while let Some(dir) = cur {
        if dir.join(".glyph").is_dir() {
            return Some(path_string(dir));
        }
        cur = dir.parent();
    }
    None
}

/// Resolve a selected folder for workspace adoption. Pure (no managed state),
/// so it's unit-testable with tempfile + git2 fixtures.
pub fn resolve_workspace(selected: &Path) -> Result<WorkspaceResolution, String> {
    let selected_canon = canonical(selected);

    let (is_git_repo, git_top_level, nested_under) =
        match git2::Repository::discover(&selected_canon) {
            Ok(repo) => match repo.workdir() {
                Some(workdir) => {
                    let top = path_string(workdir);
                    if canonical(workdir) == selected_canon {
                        (true, Some(top), None)
                    } else {
                        // Selected sits deeper than the repo top level.
                        (true, Some(top.clone()), Some(top))
                    }
                }
                // Bare repo: no working tree to nest under; treat as a plain
                // folder so it isn't adopted as a git workspace.
                None => (true, None, None),
            },
            // Not inside any repo: a plain folder is a valid workspace.
            Err(_) => (false, None, None),
        };

    Ok(WorkspaceResolution {
        selected: path_string(selected),
        is_git_repo,
        git_top_level,
        nested_under,
        glyph_conflict: ancestor_glyph(&selected_canon),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn plain_non_git_folder_is_a_valid_workspace() {
        let tmp = TempDir::new().unwrap();
        let r = resolve_workspace(tmp.path()).unwrap();
        assert!(!r.is_git_repo);
        assert!(r.nested_under.is_none());
        assert!(r.glyph_conflict.is_none());
    }

    #[test]
    fn git_root_resolves_without_nesting() {
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let r = resolve_workspace(tmp.path()).unwrap();
        assert!(r.is_git_repo);
        assert!(r.git_top_level.is_some());
        assert!(r.nested_under.is_none());
    }

    #[test]
    fn subdir_of_a_repo_reports_nested_under() {
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let sub = tmp.path().join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let r = resolve_workspace(&sub).unwrap();
        assert!(r.is_git_repo);
        assert!(r.nested_under.is_some());
    }

    #[test]
    fn ancestor_glyph_dir_flags_a_conflict() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        let sub = tmp.path().join("inner");
        std::fs::create_dir_all(&sub).unwrap();
        let r = resolve_workspace(&sub).unwrap();
        assert!(r.glyph_conflict.is_some());
    }

    #[test]
    fn own_glyph_dir_is_not_a_conflict() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        let r = resolve_workspace(tmp.path()).unwrap();
        assert!(r.glyph_conflict.is_none());
    }

    #[test]
    fn bare_repo_is_treated_as_a_plain_folder() {
        let tmp = TempDir::new().unwrap();
        let mut opts = git2::RepositoryInitOptions::new();
        opts.bare(true);
        git2::Repository::init_opts(tmp.path(), &opts).unwrap();
        let r = resolve_workspace(tmp.path()).unwrap();
        // A bare repo has no working tree, so no top level / nesting.
        assert!(r.git_top_level.is_none());
        assert!(r.nested_under.is_none());
    }
}
