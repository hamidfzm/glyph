// Disk operations for the plugins folder: scanning installed plugins,
// installing from a folder or a downloaded package (manifest-declared files
// only), reading declared assets, and uninstalling.

use super::manifest::{
    parse_manifest, validate_file_path, validate_id, MAX_FILE_BYTES, MAX_TOTAL_BYTES,
};
use super::InstalledPlugin;
use std::fs;
use std::path::Path;

/// Read one installed plugin folder (manifest + entry source).
pub(crate) fn read_plugin_dir(dir: &Path) -> Result<InstalledPlugin, String> {
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
pub(crate) fn scan_plugins_root(root: &Path) -> Vec<InstalledPlugin> {
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
pub(crate) fn write_plugin_file(dest: &Path, rel: &str, bytes: &[u8]) -> Result<(), String> {
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
pub(crate) fn install_into(root: &Path, src: &Path) -> Result<InstalledPlugin, String> {
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
pub(crate) fn install_package(root: &Path, bytes: &[u8]) -> Result<InstalledPlugin, String> {
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
pub(crate) fn read_asset_from(root: &Path, id: &str, path: &str) -> Result<Vec<u8>, String> {
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
pub(crate) fn uninstall_from(root: &Path, id: &str) -> Result<(), String> {
    validate_id(id)?;
    let dir = root.join(id);
    if dir.is_dir() {
        fs::remove_dir_all(&dir).map_err(|e| format!("cannot remove {}: {e}", dir.display()))?;
    }
    Ok(())
}
