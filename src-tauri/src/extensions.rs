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

/// The plugin file type extensions a window passes, checked the way
/// `registerFileType` in `src/lib/plugins/fileTypes.ts` checks them, so every
/// list the window's registry can hold passes and only a forged one fails.
pub fn checked_extensions(extensions: &[String]) -> Result<Vec<&str>, String> {
    extensions
        .iter()
        .map(|ext| {
            let plain = !ext.is_empty()
                && ext
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit());
            if plain {
                Ok(ext.as_str())
            } else {
                Err("Invalid file type extension: expected lowercase letters or digits".to_string())
            }
        })
        .collect()
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
        assert!(MEDIA_EXTENSIONS.contains(&"mp4"));
    }

    #[test]
    fn user_file_extensions_is_the_deduplicated_union() {
        for list in [
            MD_EXTENSIONS,
            D2_EXTENSIONS,
            CANVAS_EXTENSIONS,
            NOTEBOOK_EXTENSIONS,
            IMAGE_EXTENSIONS,
            MEDIA_EXTENSIONS,
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
    fn has_extension_matches_the_frontend_helper() {
        assert!(has_extension(Path::new("notes.MD"), &["md"]));
        assert!(has_extension(Path::new("a.b.c.md"), &["md"]));
        assert!(!has_extension(Path::new("README.md.bak"), &["md"]));
        assert!(!has_extension(Path::new("Makefile"), &["md"]));
        // A leading dot is a dotfile, not an extension. `hasExtension` in
        // src/lib/extensionConfig.ts agrees, and a test there pins it.
        assert!(!has_extension(Path::new(".md"), &["md"]));
        assert!(has_extension(Path::new(".hidden.md"), &["md"]));
    }

    #[test]
    fn checked_extensions_takes_only_what_register_file_type_does() {
        let plain = [
            "excalidraw".to_string(),
            "x3d".to_string(),
            "7z".to_string(),
        ];
        assert_eq!(
            checked_extensions(&plain).unwrap(),
            ["excalidraw", "x3d", "7z"]
        );
        assert!(checked_extensions(&[]).unwrap().is_empty());

        // Non-ASCII letters and digits too: the frontend's rule is ASCII only.
        for bad in [
            "",
            ".txt",
            "*",
            "t?t",
            "../txt",
            "a/b",
            "a\\b",
            "TXT",
            "tx t",
            "caf\u{e9}",
            "\u{663}",
        ] {
            let list = ["excalidraw".to_string(), bad.to_string()];
            let err = checked_extensions(&list).expect_err(bad);
            assert!(
                err.starts_with("Invalid file type extension"),
                "{bad}: {err}"
            );
        }
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
