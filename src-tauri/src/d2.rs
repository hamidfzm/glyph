use std::path::Path;

use crate::extensions::{has_extension, D2_EXTENSIONS};

/// D2 (https://d2lang.com) is a declarative diagram language whose file body is
/// entirely diagram source.
///
/// Unlike notebooks and canvas, `.d2` IS registered as an OS file association
/// (the `text/plain` `tauri.conf.json` -> `bundle.fileAssociations` entry), so
/// that entry is where the extension is declared and build.rs generates
/// `D2_EXTENSIONS` from it. D2 files also open via the CLI, the open dialog,
/// drag-and-drop, and the workspace file tree, all of which gate on
/// `is_supported_file`. The frontend reads the same entry through
/// `src/lib/extensionConfig.ts`.
pub fn is_d2_file(path: &Path) -> bool {
    has_extension(path, D2_EXTENSIONS)
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
