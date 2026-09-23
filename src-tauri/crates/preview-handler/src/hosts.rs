// WebView2 virtual hosts. `.example` is reserved (RFC 2606), so neither name can
// ever resolve to a real server. `src/preview/index.html`'s CSP names both.

/// Serves the preview page from the installed `web` folder.
pub const APP_HOST: &str = "glyph-preview.example";
/// Serves the previewed file's own folder, for relative images.
pub const DOCUMENT_HOST: &str = "glyph-document.example";

pub const ENTRY_URL: &str = "https://glyph-preview.example/index.html";
pub const DOCUMENT_BASE_URL: &str = "https://glyph-document.example/";

/// Only the preview page (and its in-page anchors) may load in the pane. A
/// relative link in the document resolves onto the preview host too, so the
/// host alone is not enough.
pub fn is_preview_url(uri: &str) -> bool {
    uri.strip_prefix(ENTRY_URL)
        .is_some_and(|rest| rest.is_empty() || rest.starts_with('#'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn urls_are_built_from_the_host_names() {
        assert_eq!(ENTRY_URL, format!("https://{APP_HOST}/index.html"));
        assert_eq!(DOCUMENT_BASE_URL, format!("https://{DOCUMENT_HOST}/"));
    }

    #[test]
    fn allows_the_preview_page_and_its_anchors() {
        assert!(is_preview_url(ENTRY_URL));
        assert!(is_preview_url(
            "https://glyph-preview.example/index.html#install"
        ));
    }

    #[test]
    fn blocks_everything_else() {
        for uri in [
            "https://example.com/",
            "http://glyph-preview.example/index.html",
            "https://glyph-preview.example.evil.com/",
            "https://glyph-preview.example@evil.com/",
            "https://glyph-preview.example/other.md",
            "https://glyph-preview.example/index.html?x",
            "https://glyph-preview.example/index.htmlx",
            "https://glyph-document.example/notes.md",
            "file:///C:/Users/me/notes.md",
            "about:blank",
        ] {
            assert!(!is_preview_url(uri), "{uri}");
        }
    }
}
