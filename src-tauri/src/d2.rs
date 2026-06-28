use std::path::Path;

/// D2 (https://d2lang.com) is a declarative diagram language. A `.d2` file's
/// whole body is diagram source, so — like notebooks and canvas — this is a
/// fixed extension check rather than the config-driven markdown list.
///
/// Unlike notebooks and canvas, `.d2` IS registered as an OS file association
/// (a second `tauri.conf.json` → `bundle.fileAssociations` entry), so the OS
/// can hand `.d2` files to Glyph. It also opens via the CLI, the open dialog,
/// drag-and-drop, and the workspace file tree — all of which gate on
/// `is_supported_file`. The frontend mirror is `src/lib/d2Extensions.ts`.
pub fn is_d2_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("d2"))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d2_extension_is_recognized() {
        assert!(is_d2_file(Path::new("diagram.d2")));
        assert!(is_d2_file(Path::new("/home/u/Architecture.D2")));
    }

    #[test]
    fn other_extensions_are_not_d2() {
        assert!(!is_d2_file(Path::new("readme.md")));
        assert!(!is_d2_file(Path::new("analysis.ipynb")));
        assert!(!is_d2_file(Path::new("board.canvas")));
        assert!(!is_d2_file(Path::new("noext")));
        assert!(!is_d2_file(Path::new("")));
    }
}
