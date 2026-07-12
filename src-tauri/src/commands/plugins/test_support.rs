// Shared fixtures for the plugins test modules: temp roots, on-disk plugin
// folders, and in-memory zip packages.

use std::fs;
use std::path::{Path, PathBuf};

pub(crate) const PACKAGED_MANIFEST: &str = r#"{"id":"com.x.pkg","name":"Pkg","version":"1.0.0","apiVersion":"0.16.0","files":["main.js","assets/data.txt"]}"#;

pub(crate) fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glyph_plugins_{tag}_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

pub(crate) fn write_plugin(dir: &Path, id: &str, main: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("manifest.json"),
        format!(r#"{{"id":"{id}","name":"Test","version":"1.0.0","apiVersion":"^1.0.0"}}"#),
    )
    .unwrap();
    fs::write(dir.join("main.js"), main).unwrap();
}

/// Build an in-memory zip from (name, bytes) entries for package tests.
pub(crate) fn zip_with(method: zip::CompressionMethod, entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(&mut cursor);
    let options = zip::write::SimpleFileOptions::default().compression_method(method);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    cursor.into_inner()
}

pub(crate) fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    zip_with(zip::CompressionMethod::Stored, entries)
}
