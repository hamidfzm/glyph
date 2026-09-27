use std::fs::File;
use std::io::Read;
use std::path::Path;

use serde_json::json;

/// Larger files get a notice instead of a render, so Explorer never waits on one.
pub const MAX_PREVIEW_BYTES: u64 = 2 * 1024 * 1024;

/// The JSON message the preview page renders for the file at `path`.
/// `base_url` is where the page finds images relative to the file.
pub fn host_message(path: &Path, base_url: &str) -> String {
    let message = match read_capped(path, MAX_PREVIEW_BYTES) {
        Ok(Contents::Text(content)) => {
            json!({ "kind": "document", "content": content, "baseUrl": base_url })
        }
        Ok(Contents::TooLarge(bytes)) => json!({ "kind": "tooLarge", "bytes": bytes }),
        Err(_) => json!({ "kind": "unreadable" }),
    };
    message.to_string()
}

#[derive(Debug, PartialEq)]
enum Contents {
    Text(String),
    TooLarge(u64),
}

// UTF-8 only, like the app's own reader (`fs::read_to_string`): a file the app
// cannot open previews as unreadable rather than as mojibake.
fn read_capped(path: &Path, cap: u64) -> std::io::Result<Contents> {
    let file = File::open(path)?;
    let size = file.metadata()?.len();
    // One byte past the cap is what decides, so a file that grew since the
    // stat is still caught; the stat only supplies the size for the notice.
    let mut bytes = Vec::new();
    file.take(cap + 1).read_to_end(&mut bytes)?;
    let read = bytes.len() as u64;
    if read > cap {
        return Ok(Contents::TooLarge(size.max(read)));
    }
    let text = String::from_utf8(bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let text = text
        .strip_prefix('\u{feff}')
        .map(str::to_owned)
        .unwrap_or(text);
    Ok(Contents::Text(text))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(dir: &tempfile::TempDir, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.path().join("note.md");
        fs::write(&path, bytes).unwrap();
        path
    }

    fn parsed(path: &Path) -> serde_json::Value {
        serde_json::from_str(&host_message(path, "https://doc.example/")).unwrap()
    }

    #[test]
    fn reads_utf8_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, "# Hi ✓".as_bytes());
        assert_eq!(
            read_capped(&path, 100).unwrap(),
            Contents::Text("# Hi ✓".into())
        );
    }

    #[test]
    fn strips_the_byte_order_mark() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, b"\xEF\xBB\xBF# Hi");
        assert_eq!(
            read_capped(&path, 100).unwrap(),
            Contents::Text("# Hi".into())
        );
    }

    #[test]
    fn reads_an_empty_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, b"");
        assert_eq!(
            read_capped(&path, 100).unwrap(),
            Contents::Text(String::new())
        );
    }

    #[test]
    fn reads_a_file_exactly_at_the_cap() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, &[b'a'; 10]);
        assert_eq!(
            read_capped(&path, 10).unwrap(),
            Contents::Text("a".repeat(10))
        );
    }

    #[test]
    fn reports_a_file_over_the_cap_with_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, &[b'a'; 11]);
        assert_eq!(read_capped(&path, 10).unwrap(), Contents::TooLarge(11));
    }

    #[test]
    fn rejects_invalid_utf8() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, b"\xFF\xFE# Hi");
        assert!(read_capped(&path, 100).is_err());
    }

    #[test]
    fn document_message_carries_content_and_base_url() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, b"# Hi");
        assert_eq!(
            parsed(&path),
            json!({ "kind": "document", "content": "# Hi", "baseUrl": "https://doc.example/" })
        );
    }

    #[test]
    fn too_large_message_carries_the_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = write(&dir, &vec![b'a'; MAX_PREVIEW_BYTES as usize + 1]);
        assert_eq!(
            parsed(&path),
            json!({ "kind": "tooLarge", "bytes": MAX_PREVIEW_BYTES + 1 })
        );
    }

    #[test]
    fn missing_or_undecodable_files_are_unreadable() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            parsed(&dir.path().join("gone.md")),
            json!({ "kind": "unreadable" })
        );
        let path = write(&dir, b"\xFF");
        assert_eq!(parsed(&path), json!({ "kind": "unreadable" }));
    }
}
