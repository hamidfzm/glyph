use std::path::Path;

/// Image and SVG extensions the file tree surfaces. These are not documents
/// Glyph can edit, so they are deliberately kept out of `is_supported_file`
/// (the document index that feeds the graph and wikilink autocomplete). The
/// directory listing adds them on top of that gate so assets appear in the
/// sidebar and open in the read-only image viewer. The frontend mirror is
/// `src/lib/imageExtensions.ts`.
const IMAGE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
];

/// Whether `path` is an image/SVG asset Glyph can display in the image viewer.
pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            IMAGE_EXTENSIONS.contains(&ext.as_str())
        })
        .unwrap_or(false)
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
