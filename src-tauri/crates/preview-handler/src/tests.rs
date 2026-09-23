//! The handler's constants also live in files the Rust compiler never sees:
//! the WiX fragment that registers it, and the page's CSP. These tests fail
//! when the copies drift apart.

use std::fs;
use std::path::{Path, PathBuf};

use crate::hosts::DOCUMENT_HOST;
use crate::{APP_IDENTIFIER, CLSID_TEXT};

const PREVIEW_SHELLEX: &str = "{8895b1c6-b41f-4c1c-a562-0d564250836f}";

fn repo_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .join(relative)
}

fn read(relative: &str) -> String {
    let path = repo_path(relative);
    fs::read_to_string(&path).unwrap_or_else(|e| panic!("reading {}: {e}", path.display()))
}

fn tauri_conf() -> serde_json::Value {
    serde_json::from_str(&read("src-tauri/tauri.conf.json")).expect("valid tauri.conf.json")
}

/// The extensions Glyph associates with markdown, from the one place they live.
fn markdown_extensions() -> Vec<String> {
    tauri_conf()["bundle"]["fileAssociations"]
        .as_array()
        .expect("fileAssociations")
        .iter()
        .find(|association| association["mimeType"] == "text/markdown")
        .expect("a markdown association")["ext"]
        .as_array()
        .expect("ext list")
        .iter()
        .map(|ext| ext.as_str().expect("an extension").to_owned())
        .collect()
}

#[test]
fn the_fragment_registers_the_handler_for_every_markdown_extension() {
    let fragment = read("src-tauri/windows/preview-handler.wxs");
    for ext in markdown_extensions() {
        let key = format!("Software\\Classes\\.{ext}\\shellex\\{PREVIEW_SHELLEX}");
        assert!(
            fragment.contains(&key),
            "{ext} is not registered in the WiX fragment"
        );
        assert!(
            fragment.contains(&format!(r#"<RemoveRegistryKey Root="HKLM" Key="{key}""#)),
            "{ext} would leave its shellex key behind on uninstall"
        );
    }
}

#[test]
fn the_fragment_registers_no_extension_glyph_does_not_associate() {
    let fragment = read("src-tauri/windows/preview-handler.wxs");
    let extensions = markdown_extensions();
    for line in fragment
        .lines()
        .filter(|line| line.contains("Software\\Classes\\."))
    {
        let registered = line
            .split("Software\\Classes\\.")
            .nth(1)
            .and_then(|rest| rest.split('\\').next())
            .expect("an extension in the key path");
        assert!(
            extensions.iter().any(|ext| ext == registered),
            "the fragment registers .{registered}, which Glyph does not associate"
        );
    }
}

#[test]
fn the_fragment_registers_this_crate_clsid() {
    let fragment = read("src-tauri/windows/preview-handler.wxs");
    let clsid = format!("{{{CLSID_TEXT}}}");
    assert!(
        fragment.contains(&clsid),
        "the WiX fragment registers a different CLSID"
    );
    assert!(
        fragment.contains(r#"Key="Software\Classes\CLSID\"#),
        "the CLSID must be registered under HKLM classes"
    );
}

#[test]
fn the_webview2_data_folder_sits_under_the_app_identifier() {
    assert_eq!(tauri_conf()["identifier"], APP_IDENTIFIER);
}

#[test]
fn the_page_csp_allows_images_from_the_document_host() {
    let page = read("src/preview/index.html");
    assert!(
        page.contains(&format!("img-src 'self' data: https://{DOCUMENT_HOST}")),
        "the page CSP does not admit images from the document host"
    );
}
