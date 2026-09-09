use std::path::Path;

use crate::extensions::{has_extension, CANVAS_EXTENSIONS};

/// JSON Canvas files use the `.canvas` extension (https://jsoncanvas.org).
///
/// Canvas files are intentionally NOT registered as an OS file association
/// (only markdown and D2 are, via `tauri.conf.json` -> `bundle.fileAssociations`),
/// so the extension is declared in `extensions.json` and generated into
/// `CANVAS_EXTENSIONS` by build.rs. They open via the CLI, the open dialog,
/// drag-and-drop, and the workspace file tree, all of which gate on
/// `is_supported_file`. The frontend reads the same file through
/// `src/lib/extensionConfig.ts`.
pub fn is_canvas_file(path: &Path) -> bool {
    has_extension(path, CANVAS_EXTENSIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canvas_extension_is_recognized() {
        assert!(is_canvas_file(Path::new("board.canvas")));
        assert!(is_canvas_file(Path::new("/home/u/Untitled.CANVAS")));
    }

    #[test]
    fn other_extensions_are_not_canvas() {
        assert!(!is_canvas_file(Path::new("readme.md")));
        assert!(!is_canvas_file(Path::new("analysis.ipynb")));
        assert!(!is_canvas_file(Path::new("noext")));
        assert!(!is_canvas_file(Path::new("")));
    }
}
