use std::path::Path;

use crate::extensions::{has_extension, NOTEBOOK_EXTENSIONS};

/// Jupyter notebooks use the `.ipynb` extension.
///
/// Notebooks are intentionally NOT registered as an OS file association (only
/// markdown and D2 are, via `tauri.conf.json` -> `bundle.fileAssociations`), so
/// the extension is declared in `extensions.json` and generated into
/// `NOTEBOOK_EXTENSIONS` by build.rs. They open via the CLI, the open dialog,
/// drag-and-drop, and the workspace file tree, all of which gate on this
/// function. The frontend reads the same file through
/// `src/lib/extensionConfig.ts`.
pub fn is_notebook_file(path: &Path) -> bool {
    has_extension(path, NOTEBOOK_EXTENSIONS)
}

/// Any document Glyph can open: a markdown file, a Jupyter notebook, a JSON
/// Canvas, or a D2 diagram. Used by the open-gating paths (CLI args, drag-drop,
/// file-tree walking) so every supported document type reaches the renderer
/// while everything else is rejected. Mirrors `isSupportedFile` in
/// `src/lib/notebookExtensions.ts`.
pub fn is_supported_file(path: &Path) -> bool {
    crate::is_markdown_file(path)
        || is_notebook_file(path)
        || crate::is_canvas_file(path)
        || crate::is_d2_file(path)
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
    fn supported_covers_markdown_notebooks_canvas_and_d2() {
        assert!(is_supported_file(Path::new("README.md")));
        assert!(is_supported_file(Path::new("notes.markdown")));
        assert!(is_supported_file(Path::new("analysis.ipynb")));
        assert!(is_supported_file(Path::new("board.canvas")));
        assert!(is_supported_file(Path::new("diagram.d2")));
    }

    #[test]
    fn supported_rejects_other_types() {
        assert!(!is_supported_file(Path::new("image.png")));
        assert!(!is_supported_file(Path::new("main.rs")));
    }
}
