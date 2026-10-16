//! Workspace resolution for the "one folder = one git repo" rule (#262).
//!
//! A workspace is exactly one git repository's top level. When the user picks
//! a folder we resolve whether it's a git working tree and, if so, whether
//! the selection is that working tree's top level or a nested subdirectory.
//! Nesting (a folder inside a parent `.git`, or inside another workspace's
//! `.glyph/`) makes every workspace-wide feature ambiguous, so the frontend
//! refuses it. A plain non-git folder is a valid workspace.
//!
//! The probe runs on every folder a window opens, before anything is known
//! about it, so it only asks whether a `.git` entry exists and never reads
//! what one points to. libgit2's discovery resolves the paths a repository
//! names (the target of a `.git` file, a `commondir` file, its config), and
//! on Windows resolving a network path connects to its host.

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
    /// The git working-tree top level, if `is_git_repo`.
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

/// The nearest folder at or above `start` that holds a `.git` entry: the top
/// level of the working tree `start` sits in. A link named `.git` counts
/// without being followed. A bare repository holds none, so it stays a plain
/// folder.
fn working_tree_top(start: &Path) -> Option<&Path> {
    start
        .ancestors()
        .find(|dir| dir.join(".git").symlink_metadata().is_ok())
}

/// A canonical Windows path carries a `\\?\` prefix, which reads as noise in
/// the notice this ends up in.
fn plain_string(p: &Path) -> String {
    crate::cli::plain_path(&p.to_string_lossy())
}

/// Resolve a selected folder for workspace adoption. Pure (no managed state),
/// so it's unit-testable with tempfile fixtures.
pub fn resolve_workspace(selected: &Path) -> Result<WorkspaceResolution, String> {
    let selected_canon = canonical(selected);
    let top = working_tree_top(&selected_canon);

    Ok(WorkspaceResolution {
        selected: path_string(selected),
        is_git_repo: top.is_some(),
        git_top_level: top.map(plain_string),
        // Selected sits deeper than the repo top level.
        nested_under: top.filter(|top| *top != selected_canon).map(plain_string),
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
        assert!(!r.is_git_repo);
        assert!(r.git_top_level.is_none());
        assert!(r.nested_under.is_none());
    }

    #[test]
    fn nested_under_names_the_top_level_as_a_plain_path() {
        let tmp = TempDir::new().unwrap();
        git2::Repository::init(tmp.path()).unwrap();
        let sub = tmp.path().join("a").join("b");
        std::fs::create_dir_all(&sub).unwrap();

        let top = resolve_workspace(&sub).unwrap().nested_under.unwrap();

        assert!(!top.starts_with(r"\\?\"), "{top}");
        assert_eq!(
            Path::new(&top).canonicalize().unwrap(),
            tmp.path().canonicalize().unwrap()
        );
    }

    // libgit2 would resolve each of these targets to tell whether the folder
    // is a repository. A host under `.invalid` cannot exist, should one ever
    // be looked up again.
    #[test]
    fn what_a_repository_points_to_is_never_read() {
        let tmp = TempDir::new().unwrap();
        let worktree = tmp.path().join("worktree");
        let inside = worktree.join("notes");
        std::fs::create_dir_all(&inside).unwrap();
        std::fs::write(
            worktree.join(".git"),
            "gitdir: //glyph-test-host.invalid/share/x.git\n",
        )
        .unwrap();
        std::fs::write(
            worktree.join("commondir"),
            "//glyph-test-host.invalid/share/common\n",
        )
        .unwrap();

        // The `.git` file marks the top level whatever it names.
        let top = resolve_workspace(&worktree).unwrap();
        assert!(top.is_git_repo);
        assert!(top.nested_under.is_none());
        let nested = resolve_workspace(&inside).unwrap();
        assert!(nested.nested_under.is_some());
    }
}
