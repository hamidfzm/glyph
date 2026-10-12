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
    use tauri::Manager;
    let app = mock_app();
    app.manage(crate::grants::GrantRegistry::default());
    let src = temp_root("cmd_install_src");
    write_plugin(
        &src,
        "com.x.cmdinstalled",
        "export default { activate(){} };",
    );

    app.state::<crate::grants::GrantRegistry>()
        .set_pending_plugin_dir(src.clone());
    let plugin = install_plugin(
        app.handle().clone(),
        app.state::<crate::grants::GrantRegistry>(),
    )
    .unwrap();
    assert_eq!(plugin.id, "com.x.cmdinstalled");
    assert!(Path::new(&plugin.dir).join("main.js").is_file());

    // Clean up only this plugin's folder: mock_app tests share the config
    // dir and run in parallel, so removing the parent races the other tests.
    let _ = fs::remove_dir_all(&plugin.dir);
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn install_plugin_command_errors_without_a_pending_pick() {
    use tauri::test::mock_app;
    use tauri::Manager;
    let app = mock_app();
    app.manage(crate::grants::GrantRegistry::default());
    let result = install_plugin(
        app.handle().clone(),
        app.state::<crate::grants::GrantRegistry>(),
    );
    assert_eq!(result.unwrap_err(), "no plugin folder was picked");
}

/// The registry install reaches the network, so the command is driven only
/// as far as its id check: a reserved or unsafe id is refused before any
/// request is made, with no plugins root touched.
#[test]
fn install_plugin_from_registry_refuses_a_bad_id_before_any_request() {
    use tauri::test::mock_app;
    let app = mock_app();
    for id in ["glyph.core.mermaid", "../evil", "", "a/b"] {
        let err = tauri::async_runtime::block_on(install_plugin_from_registry(
            app.handle().clone(),
            id.to_string(),
        ))
        .unwrap_err();
        assert!(err.contains("plugin id"), "{id:?}: {err}");
    }
}

#[test]
fn asset_command_reads_a_declared_file_of_an_installed_package() {
    use tauri::test::mock_app;
    let app = mock_app();
    let bytes = zip_of(&[
        ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
        ("main.js", b"export default {};"),
        ("assets/data.txt", b"payload"),
    ]);
    let root = plugins_root(&app.handle().clone()).unwrap();
    let plugin = super::store::install_package(&root, &bytes).unwrap();
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
    // Full trust must be visible on the wire, never an absent-field default.
    assert!(json.contains("\"sandbox\":false"));
}

#[test]
fn inspect_plugin_command_peeks_without_consuming_the_pick() {
    use tauri::test::mock_app;
    use tauri::Manager;
    let app = mock_app();
    app.manage(crate::grants::GrantRegistry::default());
    let src = temp_root("cmd_inspect_src");
    write_plugin(&src, "com.x.inspected", "export default { activate(){} };");

    app.state::<crate::grants::GrantRegistry>()
        .set_pending_plugin_dir(src.clone());
    let inspection = inspect_plugin(app.state::<crate::grants::GrantRegistry>()).unwrap();
    assert_eq!(inspection.id, "com.x.inspected");
    assert!(
        inspection.sandbox,
        "absent manifest flag must inspect as sandboxed"
    );

    // The pick survives inspection, so the install that follows still works.
    let plugin = install_plugin(
        app.handle().clone(),
        app.state::<crate::grants::GrantRegistry>(),
    )
    .unwrap();
    assert_eq!(plugin.id, "com.x.inspected");

    let _ = fs::remove_dir_all(&plugin.dir);
    let _ = fs::remove_dir_all(&src);
}

#[test]
fn inspect_plugin_command_errors_without_a_pending_pick() {
    use tauri::test::mock_app;
    use tauri::Manager;
    let app = mock_app();
    app.manage(crate::grants::GrantRegistry::default());
    let result = inspect_plugin(app.state::<crate::grants::GrantRegistry>());
    assert_eq!(result.unwrap_err(), "no plugin folder was picked");
}
