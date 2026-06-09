use std::path::Path;

/// JSON Canvas files always use the `.canvas` extension (https://jsoncanvas.org),
/// so — like notebooks — this is a fixed check rather than the config-driven
/// markdown list.
///
/// Canvas files are intentionally NOT registered as an OS file association
/// (only markdown is, via `tauri.conf.json` → `bundle.fileAssociations`). They
/// open via the CLI, the open dialog, drag-and-drop, and the workspace file
/// tree — all of which gate on `is_supported_file`. The frontend mirror is
/// `src/lib/canvasExtensions.ts`.
pub fn is_canvas_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("canvas"))
        .unwrap_or(false)
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
