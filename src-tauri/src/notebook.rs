use std::path::Path;

/// Jupyter notebooks always use the `.ipynb` extension, so — unlike the
/// markdown list generated from `tauri.conf.json` — this is a fixed check.
///
/// Notebooks are intentionally NOT registered as an OS file association (only
/// markdown is, via `tauri.conf.json` → `bundle.fileAssociations`). They open
/// via the CLI, the open dialog, drag-and-drop, and the workspace file tree —
/// all of which gate on this function. The frontend mirror is
/// `src/lib/notebookExtensions.ts`.
pub fn is_notebook_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("ipynb"))
        .unwrap_or(false)
}

/// Any document Glyph can open: a markdown file or a Jupyter notebook. Used by
/// the open-gating paths (CLI args, drag-drop, file-tree walking) so both
/// document types reach the renderer while everything else is rejected.
pub fn is_supported_file(path: &Path) -> bool {
    crate::is_markdown_file(path) || is_notebook_file(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ipynb_is_a_notebook() {
        assert!(is_notebook_file(Path::new("analysis.ipynb")));
        assert!(is_notebook_file(Path::new("/home/u/Untitled.IPYNB")));
    }

    #[test]
    fn other_extensions_are_not_notebooks() {
        assert!(!is_notebook_file(Path::new("readme.md")));
        assert!(!is_notebook_file(Path::new("data.json")));
        assert!(!is_notebook_file(Path::new("noext")));
        assert!(!is_notebook_file(Path::new("")));
    }

    #[test]
    fn supported_covers_markdown_and_notebooks() {
        assert!(is_supported_file(Path::new("README.md")));
        assert!(is_supported_file(Path::new("notes.markdown")));
        assert!(is_supported_file(Path::new("analysis.ipynb")));
    }

    #[test]
    fn supported_rejects_other_types() {
        assert!(!is_supported_file(Path::new("image.png")));
        assert!(!is_supported_file(Path::new("main.rs")));
    }
}
