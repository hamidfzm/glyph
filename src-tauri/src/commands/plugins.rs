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
    /// Capabilities the plugin declares; shown to the user before install.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub permissions: Vec<String>,
    /// Run isolated in a worker instead of the app context.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub sandbox: bool,
    /// Files the plugin consists of (entry + assets), as declared in the
    /// manifest. Empty for legacy two-file plugins (manifest + main only).
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub files: Vec<String>,
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
    permissions: Vec<String>,
    sandbox: bool,
    main: String,
    files: Vec<String>,
}

/// Caps for package installs: a plugin is code plus a few data assets
/// (dictionaries, fonts), not an arbitrary archive.
const MAX_PACKAGE_FILES: usize = 256;
const MAX_FILE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES: u64 = 50 * 1024 * 1024;

/// A declared file path must stay inside the plugin folder on every platform:
/// relative, `/`-separated, no empty/`.`/`..` segments, no drive colons.
fn validate_file_path(path: &str) -> Result<(), String> {
    let ok = !path.is_empty()
        && !path.contains('\\')
        && !path.contains(':')
        && !path.starts_with('/')
        && path
            .split('/')
            .all(|seg| !seg.is_empty() && seg != "." && seg != "..");
    if ok {
        Ok(())
    } else {
        Err(format!(
            "invalid manifest file path \"{path}\": use relative, '/'-separated paths inside the plugin folder"
        ))
    }
}

/// Optional `files` whitelist; when present it must be an array of valid
/// relative paths that includes the entry file.
fn parse_files(value: &serde_json::Value, main: &str) -> Result<Vec<String>, String> {
    match value.get("files") {
        None => Ok(Vec::new()),
        Some(serde_json::Value::Array(items)) => {
            let files = items
                .iter()
                .map(|v| {
                    let s = v.as_str().ok_or_else(|| {
                        String::from("manifest \"files\" must be an array of strings")
                    })?;
                    validate_file_path(s)?;
                    Ok(s.to_string())
                })
                .collect::<Result<Vec<String>, String>>()?;
            if files.len() > MAX_PACKAGE_FILES {
                return Err(format!(
                    "manifest \"files\" lists more than {MAX_PACKAGE_FILES} entries"
                ));
            }
            if !files.iter().any(|f| f == main) {
                return Err(format!(
                    "manifest \"files\" must include the entry file \"{main}\""
                ));
            }
            Ok(files)
        }
        Some(_) => Err("manifest \"files\" must be an array of strings".into()),
    }
}

/// Optional `permissions` array; when present it must be an array of strings.
fn parse_permissions(value: &serde_json::Value) -> Result<Vec<String>, String> {
    match value.get("permissions") {
        None => Ok(Vec::new()),
        Some(serde_json::Value::Array(items)) => items
            .iter()
            .map(|v| {
                v.as_str()
                    .map(|s| s.to_string())
                    .ok_or_else(|| "manifest \"permissions\" must be an array of strings".into())
            })
            .collect(),
        Some(_) => Err("manifest \"permissions\" must be an array of strings".into()),
    }
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
    let files = parse_files(&value, &main)?;
    Ok(ManifestInfo {
        id,
        name: required_str(&value, "name")?,
        version: required_str(&value, "version")?,
        api_version: required_str(&value, "apiVersion")?,
        description: value
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        permissions: parse_permissions(&value)?,
        sandbox: match value.get("sandbox") {
            None => false,
            Some(serde_json::Value::Bool(b)) => *b,
            Some(_) => return Err("manifest \"sandbox\" must be a boolean".into()),
        },
        main,
        files,
    })
}

impl ManifestInfo {
    /// The files an install copies: the declared whitelist, or just the entry
    /// for a legacy manifest without `files`.
    fn install_files(&self) -> Vec<String> {
        if self.files.is_empty() {
            vec![self.main.clone()]
        } else {
            self.files.clone()
        }
    }
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
        permissions: info.permissions,
        sandbox: info.sandbox,
        files: info.files,
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

/// Write one declared file into the plugin's install folder, creating any
/// nested asset directories. The path was already validated relative-only.
fn write_plugin_file(dest: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
    let target = dest.join(rel);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
    }
    fs::write(&target, bytes).map_err(|e| format!("cannot write {rel}: {e}"))
}

/// Copy a plugin from `src` into `root/<id>/` after validating its manifest,
/// then read it back from the installed location. Only the manifest and the
/// manifest-declared files are copied; anything else in the folder stays put.
fn install_into(root: &Path, src: &Path) -> Result<InstalledPlugin, String> {
    let manifest_json = fs::read_to_string(src.join("manifest.json"))
        .map_err(|e| format!("not a plugin folder (no manifest.json): {e}"))?;
    let info = parse_manifest(&manifest_json)?;

    let dest = root.join(&info.id);
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;
    fs::copy(src.join("manifest.json"), dest.join("manifest.json"))
        .map_err(|e| format!("cannot copy manifest.json: {e}"))?;
    for rel in info.install_files() {
        let bytes = fs::read(src.join(&rel))
            .map_err(|e| format!("declared plugin file \"{rel}\" not found: {e}"))?;
        write_plugin_file(&dest, &rel, &bytes)?;
    }
    read_plugin_dir(&dest)
}

/// Install a downloaded plugin package (a zip whose sha256 the frontend has
/// already verified against the registry entry). The archive is never
/// extracted wholesale: the manifest inside declares the plugin's files, only
/// those are copied out, and a declared file missing from the archive fails
/// the install. Size caps keep a hostile archive from filling the disk.
fn install_package(root: &Path, bytes: &[u8]) -> Result<InstalledPlugin, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("not a valid plugin package: {e}"))?;

    let mut manifest_json = String::new();
    {
        use std::io::Read;
        let mut entry = archive
            .by_name("manifest.json")
            .map_err(|_| String::from("package has no manifest.json at its root"))?;
        entry
            .read_to_string(&mut manifest_json)
            .map_err(|e| format!("cannot read manifest.json from package: {e}"))?;
    }
    let info = parse_manifest(&manifest_json)?;

    let dest = root.join(&info.id);
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;
    fs::write(dest.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("cannot write manifest.json: {e}"))?;

    let mut total: u64 = 0;
    for rel in info.install_files() {
        use std::io::Read;
        let mut entry = archive
            .by_name(&rel)
            .map_err(|_| format!("declared plugin file \"{rel}\" is missing from the package"))?;
        if entry.size() > MAX_FILE_BYTES {
            return Err(format!("plugin file \"{rel}\" exceeds the size limit"));
        }
        total += entry.size();
        if total > MAX_TOTAL_BYTES {
            return Err(String::from("plugin package exceeds the total size limit"));
        }
        let mut bytes = Vec::with_capacity(entry.size() as usize);
        entry
            .read_to_end(&mut bytes)
            .map_err(|e| format!("cannot read {rel} from package: {e}"))?;
        write_plugin_file(&dest, &rel, &bytes)?;
    }
    read_plugin_dir(&dest)
}

/// Read one manifest-declared file of an installed plugin. Backs `ctx.assets`:
/// the id and path are re-validated here, and only files the (reviewed)
/// manifest lists are readable, so a plugin can reach exactly its own content.
fn read_asset_from(root: &Path, id: &str, path: &str) -> Result<Vec<u8>, String> {
    validate_id(id)?;
    validate_file_path(path)?;
    let dir = root.join(id);
    let manifest_json = fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("plugin \"{id}\" is not installed: {e}"))?;
    let info = parse_manifest(&manifest_json)?;
    if !info.install_files().iter().any(|f| f == path) {
        return Err(format!(
            "\"{path}\" is not a declared file of plugin \"{id}\""
        ));
    }
    fs::read(dir.join(path)).map_err(|e| format!("cannot read {path}: {e}"))
}

/// Delete an installed plugin's folder. `validate_id` blocks path traversal, so
/// this can only ever remove a direct child of the plugins root. Missing is a
/// no-op (already uninstalled).
fn uninstall_from(root: &Path, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let dir = root.join(id);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()))?;
    }
    Ok(())
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

#[tauri::command]
pub fn install_plugin_package<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    // ponytail: bytes ride the JSON IPC as a number array; switch to Tauri's
    // raw request body if multi-MB installs ever feel slow.
    bytes: Vec<u8>,
) -> Result<InstalledPlugin, String> {
    install_package(&plugins_root(&app)?, &bytes)
}

#[tauri::command]
pub fn read_plugin_asset<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
    path: String,
) -> Result<Vec<u8>, String> {
    read_asset_from(&plugins_root(&app)?, &id, &path)
}

#[tauri::command]
pub fn uninstall_plugin<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    id: String,
) -> Result<(), String> {
    uninstall_from(&plugins_root(&app)?, &id)
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

    /// Build an in-memory zip from (name, bytes) entries for package tests.
    fn zip_of(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut cursor = std::io::Cursor::new(Vec::new());
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
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
        let info =
            parse_manifest(r#"{"id":"a.b","name":"n","version":"1.0.0","apiVersion":"^1.0.0"}"#)
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
}
