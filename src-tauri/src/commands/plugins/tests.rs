// Connected tests for the plugin commands: the Tauri command surface driven
// through a mock app, and the wire shape of InstalledPlugin. Unit tests for
// parsing and disk operations live inline in manifest.rs and store.rs.

use super::test_support::*;
use super::*;
use std::fs;
use std::path::Path;

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

    // Clean up only this plugin's folder: mock_app tests share the config
    // dir and run in parallel, so removing the parent races the other tests.
    let _ = fs::remove_dir_all(&plugin.dir);
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn package_and_asset_commands_run_via_mock_app() {
    use tauri::test::mock_app;
    let app = mock_app();
    let bytes = zip_of(&[
        ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
        ("main.js", b"export default {};"),
        ("assets/data.txt", b"payload"),
    ]);

    let plugin = install_plugin_package(app.handle().clone(), bytes).unwrap();
    assert_eq!(plugin.id, "com.x.pkg");

    let asset = read_plugin_asset(
        app.handle().clone(),
        "com.x.pkg".to_string(),
        "assets/data.txt".to_string(),
    )
    .unwrap();
    assert_eq!(asset, b"payload");

    // Clean up only this plugin's folder: mock_app tests share the config
    // dir and run in parallel, so removing the parent races the other tests.
    let _ = fs::remove_dir_all(&plugin.dir);
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
