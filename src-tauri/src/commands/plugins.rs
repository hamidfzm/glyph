// Installed-plugin discovery and installation. Plugins live as folders under
// `<app config dir>/plugins/<id>/`, each holding a `manifest.json` and a
// pre-built ESM entry file (default `main.js`). The frontend loads the entry
// source returned here via a dynamic module import; no plugin code runs in Rust.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub id: String,
    pub name: String,
    pub version: String,
    pub api_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Absolute path of the installed plugin folder.
    pub dir: String,
    /// Source text of the plugin's ESM entry file.
    pub main_source: String,
}

struct ManifestInfo {
    id: String,
    name: String,
    version: String,
    api_version: String,
    description: Option<String>,
    main: String,
}

fn required_str(value: &serde_json::Value, key: &str) -> Result<String, String> {
    match value.get(key).and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => Ok(s.trim().to_string()),
        _ => Err(format!("manifest.json is missing required field \"{key}\"")),
    }
}

/// The plugin id doubles as its folder name, so restrict it to characters that
/// are safe on every filesystem and can never traverse out of the plugins dir.
fn validate_id(id: &str) -> Result<(), String> {
    let ok = !id.is_empty()
        && !id.starts_with('.')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'));
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid plugin id \"{id}\": use only letters, digits, '.', '_' and '-'"
        ))
    }
}

fn parse_manifest(json: &str) -> Result<ManifestInfo, String> {
    let value: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("manifest.json is not valid JSON: {e}"))?;
    let id = required_str(&value, "id")?;
    validate_id(&id)?;
    let main = match value.get("main").and_then(|v| v.as_str()) {
        Some(s) if !s.trim().is_empty() => s.trim().to_string(),
        _ => "main.js".to_string(),
    };
    // The entry must be a plain file name inside the plugin folder.
    if main.contains('/') || main.contains('\\') || main.starts_with('.') {
        return Err(format!("invalid manifest \"main\": {main}"));
    }
    Ok(ManifestInfo {
        id,
        name: required_str(&value, "name")?,
        version: required_str(&value, "version")?,
        api_version: required_str(&value, "apiVersion")?,
        description: value
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        main,
    })
}

/// Read one installed plugin folder (manifest + entry source).
fn read_plugin_dir(dir: &Path) -> Result<InstalledPlugin, String> {
    let manifest_json = fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("cannot read manifest.json in {}: {e}", dir.display()))?;
    let info = parse_manifest(&manifest_json)?;
    let main_source = fs::read_to_string(dir.join(&info.main))
        .map_err(|e| format!("cannot read {} in {}: {e}", info.main, dir.display()))?;
    Ok(InstalledPlugin {
        id: info.id,
        name: info.name,
        version: info.version,
        api_version: info.api_version,
        description: info.description,
        dir: dir.to_string_lossy().to_string(),
        main_source,
    })
}

/// Enumerate every loadable plugin under the plugins root. Folders that fail
/// to parse are skipped (reported on stderr) rather than failing the whole
/// list, so one broken plugin can't take down the rest.
fn scan_plugins_root(root: &Path) -> Vec<InstalledPlugin> {
    let Ok(entries) = fs::read_dir(root) else {
        return Vec::new(); // No plugins dir yet, nothing installed.
    };
    let mut plugins: Vec<InstalledPlugin> = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        match read_plugin_dir(&path) {
            Ok(plugin) => plugins.push(plugin),
            Err(err) => eprintln!("Skipping plugin folder {}: {err}", path.display()),
        }
    }
    plugins.sort_by(|a, b| a.id.cmp(&b.id));
    plugins
}

/// Copy a plugin from `src` into `root/<id>/` after validating its manifest,
/// then read it back from the installed location. Only the manifest and the
/// entry file are copied; a plugin is exactly those two files.
fn install_into(root: &Path, src: &Path) -> Result<InstalledPlugin, String> {
    let manifest_json = fs::read_to_string(src.join("manifest.json"))
        .map_err(|e| format!("not a plugin folder (no manifest.json): {e}"))?;
    let info = parse_manifest(&manifest_json)?;
    let src_main = src.join(&info.main);
    if !src_main.is_file() {
        return Err(format!("plugin entry file \"{}\" not found", info.main));
    }

    let dest = root.join(&info.id);
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;
    fs::copy(src.join("manifest.json"), dest.join("manifest.json"))
        .map_err(|e| format!("cannot copy manifest.json: {e}"))?;
    fs::copy(&src_main, dest.join(&info.main))
        .map_err(|e| format!("cannot copy {}: {e}", info.main))?;
    read_plugin_dir(&dest)
}

fn plugins_root<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("plugins"))
        .map_err(|e| format!("cannot resolve app config dir: {e}"))
}

#[tauri::command]
pub fn list_plugins<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
) -> Result<Vec<InstalledPlugin>, String> {
    Ok(scan_plugins_root(&plugins_root(&app)?))
}

#[tauri::command]
pub fn install_plugin<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    src_dir: String,
) -> Result<InstalledPlugin, String> {
    install_into(&plugins_root(&app)?, Path::new(&src_dir))
}

#[cfg(test)]
mod tests {
    use super::*;

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
        let with_id = |id: &str| {
            format!(r#"{{"id":"{id}","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}}"#)
        };
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
        let json = r#"{"id":"ok.id","name":"n","version":"1.0.0","apiVersion":"^1.0.0","main":"sub\\x.js"}"#;
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

    #[test]
    fn list_plugins_command_returns_ok_for_a_mock_app() {
        use tauri::test::mock_app;
        let app = mock_app();
        assert!(list_plugins(app.handle().clone()).is_ok());
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

        let plugin =
            install_plugin(app.handle().clone(), src.to_string_lossy().to_string()).unwrap();
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
            dir: "d".into(),
            main_source: "s".into(),
        };
        let json = serde_json::to_string(&plugin).unwrap();
        assert!(json.contains("\"apiVersion\""));
        assert!(json.contains("\"mainSource\""));
        assert!(!json.contains("\"description\""));
    }
}
