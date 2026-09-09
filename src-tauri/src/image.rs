use std::path::Path;

use crate::extensions::{has_extension, IMAGE_EXTENSIONS};

/// Whether `path` is an image/SVG asset Glyph can display in the image viewer.
///
/// Images are not documents Glyph can edit, so they are deliberately kept out
/// of `is_supported_file` (the document index that feeds the graph and wikilink
/// autocomplete); the directory listing adds them on top of that gate so assets
/// appear in the sidebar. They are not an OS file association either, so the
/// list is declared in `extensions.json` and generated into `IMAGE_EXTENSIONS`
/// by build.rs. The frontend reads the same file through
/// `src/lib/extensionConfig.ts`.
pub fn is_image_file(path: &Path) -> bool {
    has_extension(path, IMAGE_EXTENSIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn common_image_extensions_are_recognized() {
        for name in [
            "photo.png",
            "scan.JPG",
            "frame.jpeg",
            "loop.gif",
            "shot.webp",
            "old.bmp",
            "logo.svg",
            "next.avif",
            "favicon.ICO",
        ] {
            assert!(is_image_file(Path::new(name)), "{name} should be an image");
        }
    }

    #[test]
    fn non_image_extensions_are_rejected() {
        assert!(!is_image_file(Path::new("readme.md")));
        assert!(!is_image_file(Path::new("analysis.ipynb")));
        assert!(!is_image_file(Path::new("board.canvas")));
        assert!(!is_image_file(Path::new("noext")));
        assert!(!is_image_file(Path::new("")));
    }
}
