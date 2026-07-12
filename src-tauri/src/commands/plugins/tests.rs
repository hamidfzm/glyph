use super::manifest::*;
use super::store::*;
use super::*;
use std::fs;
use std::path::{Path, PathBuf};

fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("glyph_plugins_{tag}_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write_plugin(dir: &Path, id: &str, main: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("manifest.json"),
        format!(r#"{{"id":"{id}","name":"Test","version":"1.0.0","apiVersion":"^1.0.0"}}"#),
    )
    .unwrap();
    fs::write(dir.join("main.js"), main).unwrap();
}

#[test]
fn parse_manifest_reads_all_fields() {
    let info = parse_manifest(
        r#"{"id":"com.x.demo","name":"Demo","version":"2.1.0","apiVersion":"^1.0.0","description":"d","main":"index.js"}"#,
    )
    .unwrap();
    assert_eq!(info.id, "com.x.demo");
    assert_eq!(info.name, "Demo");
    assert_eq!(info.version, "2.1.0");
    assert_eq!(info.api_version, "^1.0.0");
    assert_eq!(info.description.as_deref(), Some("d"));
    assert_eq!(info.main, "index.js");
}

#[test]
fn parse_manifest_defaults_main_to_main_js() {
    let info = parse_manifest(
        r#"{"id":"com.x.demo","name":"Demo","version":"1.0.0","apiVersion":"^1.0.0"}"#,
    )
    .unwrap();
    assert_eq!(info.main, "main.js");
}

#[test]
fn parse_manifest_rejects_missing_required_fields() {
    for json in [
        r#"{}"#,
        r#"{"id":"a"}"#,
        r#"{"id":"a","name":"n"}"#,
        r#"{"id":"a","name":"n","version":"1.0.0"}"#,
        r#"{"id":"  ","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#,
    ] {
        assert!(parse_manifest(json).is_err(), "should reject: {json}");
    }
}

#[test]
fn parse_manifest_rejects_unsafe_ids_and_entries() {
    let with_id =
        |id: &str| format!(r#"{{"id":"{id}","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}}"#);
    for id in ["../evil", "a/b", "a\\b", ".hidden", "spa ce"] {
        assert!(
            parse_manifest(&with_id(id)).is_err(),
            "should reject id {id}"
        );
    }
    let bad_main =
        r#"{"id":"ok.id","name":"n","version":"1.0.0","apiVersion":"^1.0.0","main":"../x.js"}"#;
    assert!(parse_manifest(bad_main).is_err());
}

#[test]
fn parse_manifest_rejects_invalid_json() {
    assert!(parse_manifest("not json").is_err());
}

#[test]
fn read_plugin_dir_round_trips() {
    let root = temp_root("read");
    let dir = root.join("com.x.demo");
    write_plugin(&dir, "com.x.demo", "export default {};");

    let plugin = read_plugin_dir(&dir).unwrap();
    assert_eq!(plugin.id, "com.x.demo");
    assert_eq!(plugin.main_source, "export default {};");
    assert_eq!(plugin.dir, dir.to_string_lossy());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn read_plugin_dir_errors_when_entry_is_missing() {
    let root = temp_root("noentry");
    let dir = root.join("com.x.demo");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("manifest.json"),
        r#"{"id":"com.x.demo","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#,
    )
    .unwrap();

    assert!(read_plugin_dir(&dir).is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn scan_skips_broken_plugins_and_sorts_by_id() {
    let root = temp_root("scan");
    write_plugin(&root.join("b-plugin"), "b.plugin", "export default {};");
    write_plugin(&root.join("a-plugin"), "a.plugin", "export default {};");
    fs::create_dir_all(root.join("broken")).unwrap(); // no manifest
    fs::write(root.join("stray-file.txt"), "ignored").unwrap();

    let plugins = scan_plugins_root(&root);
    let ids: Vec<&str> = plugins.iter().map(|p| p.id.as_str()).collect();
    assert_eq!(ids, ["a.plugin", "b.plugin"]);

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn scan_returns_empty_when_root_does_not_exist() {
    let missing = std::env::temp_dir().join("glyph_plugins_definitely_missing");
    assert!(scan_plugins_root(&missing).is_empty());
}

#[test]
fn install_copies_manifest_and_entry_into_root() {
    let root = temp_root("install_root");
    let src = temp_root("install_src");
    write_plugin(&src, "com.x.installed", "export default { activate(){} };");
    fs::write(src.join("notes.txt"), "not copied").unwrap();

    let plugin = install_into(&root, &src).unwrap();
    assert_eq!(plugin.id, "com.x.installed");
    let dest = root.join("com.x.installed");
    assert!(dest.join("manifest.json").is_file());
    assert!(dest.join("main.js").is_file());
    assert!(!dest.join("notes.txt").exists());

    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn install_rejects_a_folder_without_manifest() {
    let root = temp_root("install_bad_root");
    let src = temp_root("install_bad_src");
    assert!(install_into(&root, &src).is_err());
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn parse_manifest_rejects_backslash_in_main() {
    let json =
        r#"{"id":"ok.id","name":"n","version":"1.0.0","apiVersion":"^1.0.0","main":"sub\\x.js"}"#;
    assert!(parse_manifest(json).is_err());
}

#[test]
fn install_errors_when_the_entry_file_is_missing() {
    let root = temp_root("install_noentry_root");
    let src = temp_root("install_noentry_src");
    // Manifest is valid but main.js was never written.
    fs::write(
        src.join("manifest.json"),
        r#"{"id":"com.x.demo","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#,
    )
    .unwrap();

    assert!(install_into(&root, &src).is_err());
    let _ = fs::remove_dir_all(&root);
    let _ = fs::remove_dir_all(&src);
}

/// Build an in-memory zip from (name, bytes) entries for package tests.
fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
    use std::io::Write;
    let mut cursor = std::io::Cursor::new(Vec::new());
    let mut writer = zip::ZipWriter::new(&mut cursor);
    let options =
        zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    for (name, bytes) in entries {
        writer.start_file(*name, options).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap();
    cursor.into_inner()
}

const PACKAGED_MANIFEST: &str = r#"{"id":"com.x.pkg","name":"Pkg","version":"1.0.0","apiVersion":"0.16.0","files":["main.js","assets/data.txt"]}"#;

#[test]
fn install_package_copies_only_declared_files() {
    let root = temp_root("pkg");
    let bytes = zip_of(&[
        ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
        ("main.js", b"export default { activate(){} };"),
        ("assets/data.txt", b"payload"),
        ("extra.exe", b"smuggled"),
    ]);

    let plugin = install_package(&root, &bytes).unwrap();
    assert_eq!(plugin.id, "com.x.pkg");
    assert_eq!(plugin.files, ["main.js", "assets/data.txt"]);
    let dest = root.join("com.x.pkg");
    assert!(dest.join("assets/data.txt").is_file());
    assert!(
        !dest.join("extra.exe").exists(),
        "undeclared files must not land on disk"
    );

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn install_package_fails_when_a_declared_file_is_missing() {
    let root = temp_root("pkg_missing");
    let bytes = zip_of(&[
        ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
        ("main.js", b"export default {};"),
        // assets/data.txt declared but absent
    ]);
    let err = install_package(&root, &bytes).unwrap_err();
    assert!(err.contains("assets/data.txt"), "unexpected error: {err}");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn install_package_rejects_a_zip_without_manifest_and_garbage_bytes() {
    let root = temp_root("pkg_bad");
    let no_manifest = zip_of(&[("main.js", b"x" as &[u8])]);
    assert!(install_package(&root, &no_manifest).is_err());
    assert!(install_package(&root, b"not a zip").is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn parse_manifest_validates_the_files_whitelist() {
    let with_files = |files: &str| {
        format!(
            r#"{{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"0.16.0","files":{files}}}"#
        )
    };
    let ok = parse_manifest(&with_files(r#"["main.js","assets/fa.dic"]"#)).unwrap();
    assert_eq!(ok.files, ["main.js", "assets/fa.dic"]);
    assert_eq!(ok.install_files(), ok.files);

    // Legacy manifest: no files -> install just the entry.
    let legacy =
        parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"0.16.0"}"#)
            .unwrap();
    assert_eq!(legacy.install_files(), ["main.js"]);

    for bad in [
        r#"["assets/fa.dic"]"#,       // must include main
        r#"["main.js","../escape"]"#, // traversal
        r#"["main.js","/abs"]"#,      // absolute
        r#"["main.js","a\\b"]"#,      // backslash
        r#"["main.js","c:evil"]"#,    // drive colon
        r#"["main.js",""]"#,          // empty
        r#"["main.js","a//b"]"#,      // empty segment
        r#"["main.js","./x"]"#,       // dot segment
        r#""main.js""#,               // not an array
        r#"[1]"#,                     // not strings
    ] {
        assert!(
            parse_manifest(&with_files(bad)).is_err(),
            "should reject files={bad}"
        );
    }
}

#[test]
fn read_asset_serves_only_declared_files() {
    let root = temp_root("asset");
    let bytes = zip_of(&[
        ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
        ("main.js", b"export default {};"),
        ("assets/data.txt", b"payload"),
    ]);
    install_package(&root, &bytes).unwrap();

    assert_eq!(
        read_asset_from(&root, "com.x.pkg", "assets/data.txt").unwrap(),
        b"payload"
    );
    // The entry file itself is declared, so it is readable too.
    assert!(read_asset_from(&root, "com.x.pkg", "main.js").is_ok());
    // Undeclared name, traversal, bad id: all rejected.
    assert!(read_asset_from(&root, "com.x.pkg", "manifest.json").is_err());
    assert!(read_asset_from(&root, "com.x.pkg", "../outside").is_err());
    assert!(read_asset_from(&root, "../escape", "main.js").is_err());
    assert!(read_asset_from(&root, "com.x.absent", "main.js").is_err());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn uninstall_removes_the_plugin_folder() {
    let root = temp_root("uninstall");
    write_plugin(&root.join("com.x.gone"), "com.x.gone", "export default {};");
    assert!(root.join("com.x.gone").is_dir());

    uninstall_from(&root, "com.x.gone").unwrap();
    assert!(!root.join("com.x.gone").exists());
    // Missing is a no-op, not an error.
    uninstall_from(&root, "com.x.gone").unwrap();

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn uninstall_rejects_an_unsafe_id() {
    let root = temp_root("uninstall_bad");
    assert!(uninstall_from(&root, "../escape").is_err());
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn list_plugins_command_returns_ok_for_a_mock_app() {
    use tauri::test::mock_app;
    let app = mock_app();
    assert!(list_plugins(app.handle().clone()).is_ok());
}

#[test]
fn uninstall_plugin_command_runs_via_mock_app() {
    use tauri::test::mock_app;
    let app = mock_app();
    // No such plugin installed: the command treats missing as a no-op, Ok.
    assert!(uninstall_plugin(app.handle().clone(), "com.x.absent".to_string()).is_ok());
}

#[test]
fn install_plugin_command_installs_via_mock_app() {
    use tauri::test::mock_app;
    let app = mock_app();
    let src = temp_root("cmd_install_src");
    write_plugin(
        &src,
        "com.x.cmdinstalled",
        "export default { activate(){} };",
    );

    let plugin = install_plugin(app.handle().clone(), src.to_string_lossy().to_string()).unwrap();
    assert_eq!(plugin.id, "com.x.cmdinstalled");
    assert!(Path::new(&plugin.dir).join("main.js").is_file());

    // Clean up the install we wrote into the mock app's config dir.
    if let Some(plugins_dir) = Path::new(&plugin.dir).parent() {
        let _ = fs::remove_dir_all(plugins_dir);
    }
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn installed_plugin_serializes_camel_case() {
    let plugin = InstalledPlugin {
        id: "i".into(),
        name: "n".into(),
        version: "1.0.0".into(),
        api_version: "^1.0.0".into(),
        description: None,
        permissions: Vec::new(),
        sandbox: false,
        files: Vec::new(),
        dir: "d".into(),
        main_source: "s".into(),
    };
    let json = serde_json::to_string(&plugin).unwrap();
    assert!(json.contains("\"apiVersion\""));
    assert!(json.contains("\"mainSource\""));
    assert!(!json.contains("\"description\""));
    assert!(!json.contains("\"permissions\""));
    assert!(!json.contains("\"sandbox\""));
}

#[test]
fn parse_manifest_reads_sandbox_flag() {
    let with_sandbox = |v: &str| {
        format!(
            r#"{{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","sandbox":{v}}}"#
        )
    };
    assert!(parse_manifest(&with_sandbox("true")).unwrap().sandbox);
    assert!(!parse_manifest(&with_sandbox("false")).unwrap().sandbox);
    assert!(
        !parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#)
            .unwrap()
            .sandbox
    );
    assert!(parse_manifest(&with_sandbox("\"yes\"")).is_err());
}

#[test]
fn parse_manifest_reads_permissions() {
    let info = parse_manifest(
        r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":["workspace:read","network:example.com"]}"#,
    )
    .unwrap();
    assert_eq!(info.permissions, ["workspace:read", "network:example.com"]);
}

#[test]
fn parse_manifest_defaults_permissions_to_empty() {
    let info = parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#)
        .unwrap();
    assert!(info.permissions.is_empty());
}

#[test]
fn parse_manifest_rejects_non_string_permissions() {
    for json in [
        r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":"workspace:read"}"#,
        r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0","permissions":[1]}"#,
    ] {
        assert!(parse_manifest(json).is_err(), "should reject: {json}");
    }
}
