//! Every supported file extension, generated at build time.
//!
//! `build.rs` reads `tauri.conf.json` (for the types registered as OS file
//! associations) and `extensions.json` (for everything else) and emits one
//! const per category plus `USER_FILE_EXTENSIONS`, their union. The frontend
//! reads the same two files through `src/lib/extensionConfig.ts`, so adding an
//! extension is a one-line edit to one JSON file and both sides pick it up.

use std::path::Path;

include!(concat!(env!("OUT_DIR"), "/extensions.rs"));

/// Whether `path` ends in one of `extensions`, ignoring case. Mirrors
/// `hasExtension` in `src/lib/extensionConfig.ts`.
pub fn has_extension(path: &Path, extensions: &[&str]) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            let ext = ext.to_ascii_lowercase();
            extensions.contains(&ext.as_str())
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_list_is_populated_from_the_config() {
        assert!(MD_EXTENSIONS.contains(&"md"));
        assert!(MD_EXTENSIONS.contains(&"markdown"));
        assert!(D2_EXTENSIONS.contains(&"d2"));
        assert!(CANVAS_EXTENSIONS.contains(&"canvas"));
        assert!(NOTEBOOK_EXTENSIONS.contains(&"ipynb"));
        assert!(IMAGE_EXTENSIONS.contains(&"png"));
    }

    #[test]
    fn user_file_extensions_is_the_deduplicated_union() {
        for list in [
            MD_EXTENSIONS,
            D2_EXTENSIONS,
            CANVAS_EXTENSIONS,
            NOTEBOOK_EXTENSIONS,
            IMAGE_EXTENSIONS,
        ] {
            for ext in list {
                assert!(
                    USER_FILE_EXTENSIONS.contains(ext),
                    "{ext} missing from USER_FILE_EXTENSIONS"
                );
            }
        }

        let mut seen = USER_FILE_EXTENSIONS.to_vec();
        seen.sort_unstable();
        let deduplicated = seen.len();
        seen.dedup();
        assert_eq!(seen.len(), deduplicated, "duplicate extension in the union");
    }

    #[test]
    fn no_source_code_extension_is_redactable() {
        // The telemetry redaction matches any file name ending in one of these,
        // and `redact_frame_path` falls back to it. A source extension here
        // would start redacting stack frames.
        for ext in ["rs", "ts", "tsx", "js", "json"] {
            assert!(
                !USER_FILE_EXTENSIONS.contains(&ext),
                "{ext} would make stack frames unreadable"
            );
        }
    }
}
