use std::path::Path;

// Single source of truth shared with the frontend
// (src/lib/markdownExtensions.ts imports the same JSON).
// build.rs reads markdown-extensions.json at compile time and emits this const.
include!(concat!(env!("OUT_DIR"), "/md_extensions.rs"));

pub fn is_markdown_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| MD_EXTENSIONS.contains(&ext.to_lowercase().as_str()))
        .unwrap_or(false)
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
    fn case_insensitive() {
        assert!(is_markdown_file(Path::new("README.MD")));
        assert!(is_markdown_file(Path::new("readme.Md")));
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
