//! One spelling for each file, so that comparing two paths as strings answers
//! whether they name the same file. Tabs, the write queue, the watcher map and
//! the window registry all do, and none of them looks anything up.

use std::path::Path;

use icu_normalizer::ComposingNormalizerBorrowed;

use crate::cli::plain_path;

/// Fold a path for comparison: separators unified, case and Unicode
/// normalization form ignored. Paths that fold alike are only candidates for
/// one file, which is the volume's to say.
pub fn folded(path: &str) -> String {
    let composed = ComposingNormalizerBorrowed::new_nfc().normalize(path);
    composed.replace('\\', "/").to_lowercase()
}

/// How `given` is spelled, `canonical` being what the volume resolved it to:
/// with no `\\?\` prefix, and the volume's own casing and normalization form.
///
/// A path that differs from `canonical` by more than that reaches its file
/// through a link, a mapped drive or a short name, and keeps its spelling. The
/// resolved path can sit outside the workspace it was opened from, and a mapped
/// drive resolves to a share, which is refused when the session is restored.
/// Folding too much cannot pick the wrong file: `canonical` is `given`'s file.
pub fn on_disk_spelling(given: &str, canonical: &Path) -> String {
    let given = plain_path(given);
    let on_disk = plain_path(&canonical.to_string_lossy());
    if folded(&given) == folded(&on_disk) {
        on_disk
    } else {
        given
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spelled(given: &str, canonical: &str) -> String {
        on_disk_spelling(given, Path::new(canonical))
    }

    #[test]
    fn a_windows_path_loses_its_verbatim_prefix() {
        let canonical = r"\\?\C:\Docs\a.md";
        assert_eq!(spelled(canonical, canonical), r"C:\Docs\a.md");
        assert_eq!(spelled(r"C:\Docs\a.md", canonical), r"C:\Docs\a.md");
    }

    #[test]
    fn a_network_path_keeps_its_two_leading_separators() {
        let canonical = r"\\?\UNC\server\share\a.md";
        assert_eq!(spelled(canonical, canonical), r"\\server\share\a.md");
        assert_eq!(
            spelled(r"\\server\share\a.md", canonical),
            r"\\server\share\a.md"
        );
    }

    #[test]
    fn a_windows_path_takes_the_casing_on_disk_at_every_level() {
        let canonical = r"\\?\C:\Docs\Notes.md";
        assert_eq!(spelled(r"C:\Docs\NOTES.md", canonical), r"C:\Docs\Notes.md");
        assert_eq!(spelled(r"c:\DOCS\notes.MD", canonical), r"C:\Docs\Notes.md");
    }

    #[test]
    fn forward_slashes_on_windows_take_the_separators_on_disk() {
        assert_eq!(
            spelled("C:/Docs/a.md", r"\\?\C:\Docs\a.md"),
            r"C:\Docs\a.md"
        );
    }

    #[test]
    fn a_unix_path_takes_the_casing_on_disk() {
        // What `realpath` answers on a macOS volume that ignores case.
        assert_eq!(
            spelled("/Docs/NOTES.md", "/Docs/Notes.md"),
            "/Docs/Notes.md"
        );
    }

    #[test]
    fn a_path_takes_the_normalization_form_on_disk() {
        let decomposed = "/Docs/cafe\u{301}.md";
        assert_eq!(spelled("/Docs/caf\u{e9}.md", decomposed), decomposed);
    }

    #[test]
    fn casing_beyond_ascii_is_folded() {
        assert_eq!(spelled(r"C:\Ä.md", r"\\?\C:\ä.md"), r"C:\ä.md");
    }

    #[test]
    fn a_path_already_on_disk_is_unchanged() {
        assert_eq!(
            spelled("/Docs/Notes.md", "/Docs/Notes.md"),
            "/Docs/Notes.md"
        );
        assert_eq!(
            spelled("/Docs/notes.md", "/Docs/notes.md"),
            "/Docs/notes.md"
        );
    }

    #[test]
    fn a_path_through_a_link_keeps_its_spelling() {
        assert_eq!(
            spelled("/workspace/link.md", "/shared/target.md"),
            "/workspace/link.md"
        );
        assert_eq!(
            spelled(r"C:\link\a.md", r"\\?\D:\real\a.md"),
            r"C:\link\a.md"
        );
    }

    #[test]
    fn a_path_through_a_link_still_loses_its_verbatim_prefix() {
        assert_eq!(
            spelled(r"\\?\C:\link\a.md", r"\\?\D:\real\a.md"),
            r"C:\link\a.md"
        );
    }

    #[test]
    fn a_mapped_drive_is_not_rewritten_to_its_share() {
        assert_eq!(
            spelled(r"Z:\a.md", r"\\?\UNC\server\share\a.md"),
            r"Z:\a.md"
        );
    }

    #[test]
    fn a_short_name_keeps_its_spelling() {
        assert_eq!(
            spelled(r"C:\PROGRA~1\a.md", r"\\?\C:\Program Files\a.md"),
            r"C:\PROGRA~1\a.md"
        );
    }

    #[test]
    fn folding_ignores_case_separators_and_normalization_form() {
        assert_eq!(folded(r"Notes\A.md"), folded("notes/a.md"));
        assert_eq!(folded("cafe\u{301}.md"), folded("CAF\u{c9}.md"));
        assert_ne!(folded("notes/a.md"), folded("notes/b.md"));
    }
}
