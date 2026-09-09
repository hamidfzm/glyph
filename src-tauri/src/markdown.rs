use std::path::Path;

// Single source of truth shared with the frontend
// (src/lib/extensionConfig.ts reads the same JSON). build.rs generates
// MD_EXTENSIONS from tauri.conf.json at compile time.
pub fn is_markdown_file(path: &Path) -> bool {
    crate::extensions::has_extension(path, crate::extensions::MD_EXTENSIONS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md_extension() {
        assert!(is_markdown_file(Path::new("README.md")));
    }

    #[test]
    fn markdown_extension() {
        assert!(is_markdown_file(Path::new("notes.markdown")));
    }

    #[test]
    fn mdown_extension() {
        assert!(is_markdown_file(Path::new("doc.mdown")));
    }

    #[test]
    fn mkd_extension() {
        assert!(is_markdown_file(Path::new("file.mkd")));
    }

    #[test]
    fn mkdn_extension() {
        assert!(is_markdown_file(Path::new("file.mkdn")));
    }

    #[test]
    fn mdx_extension() {
        assert!(is_markdown_file(Path::new("doc.mdx")));
    }

    #[test]
    fn mdtext_extensions() {
        assert!(is_markdown_file(Path::new("doc.mdtext")));
        assert!(is_markdown_file(Path::new("doc.mdtxt")));
    }

    #[test]
    fn mmd_extension() {
        // `.mmd` covers both MultiMarkdown text and Mermaid diagram sources.
        assert!(is_markdown_file(Path::new("diagram.mmd")));
        assert!(is_markdown_file(Path::new("note.MMD")));
    }

    #[test]
    fn case_insensitive() {
        // Exhaustive case combinations for the two common extensions so
        // weird-cased file managers (macOS HFS+, USB sticks formatted with
        // mixed case enforcement, etc.) all open correctly.
        for ext in ["md", "mD", "Md", "MD"] {
            assert!(
                is_markdown_file(Path::new(&format!("readme.{ext}"))),
                "expected .{ext} to be recognised"
            );
        }
        for ext in ["mmd", "mmD", "mMd", "mMD", "Mmd", "MmD", "MMd", "MMD"] {
            assert!(
                is_markdown_file(Path::new(&format!("diagram.{ext}"))),
                "expected .{ext} to be recognised"
            );
        }
        // Sample of long-form variants to confirm tolower-then-compare works
        // for >2 char extensions too.
        assert!(is_markdown_file(Path::new("doc.MARKDOWN")));
        assert!(is_markdown_file(Path::new("doc.MarkDown")));
        assert!(is_markdown_file(Path::new("doc.MdX")));
        assert!(is_markdown_file(Path::new("doc.Mdown")));
    }

    #[test]
    fn not_markdown_txt() {
        assert!(!is_markdown_file(Path::new("file.txt")));
    }

    #[test]
    fn not_markdown_rs() {
        assert!(!is_markdown_file(Path::new("main.rs")));
    }

    #[test]
    fn not_markdown_no_extension() {
        assert!(!is_markdown_file(Path::new("Makefile")));
    }

    #[test]
    fn not_markdown_hidden_file() {
        assert!(!is_markdown_file(Path::new(".gitignore")));
    }

    #[test]
    fn with_directory_path() {
        assert!(is_markdown_file(Path::new("/home/user/docs/README.md")));
        assert!(is_markdown_file(Path::new(
            "./relative/path/notes.markdown"
        )));
    }

    #[test]
    fn empty_path() {
        assert!(!is_markdown_file(Path::new("")));
    }
}
