// Disk operations for the plugins folder: scanning installed plugins,
// installing from a folder or a downloaded package (manifest-declared files
// only), reading declared assets, and uninstalling.

use super::manifest::{
    parse_manifest, validate_file_path, validate_id, ManifestInfo, INSTALL_MARKER, MAX_FILE_BYTES,
    MAX_TOTAL_BYTES,
};
use super::{InstalledPlugin, PluginInspection};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

/// Where an installed plugin came from.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum InstallSource {
    /// Downloaded from the registry and checked against its hash.
    Marketplace,
    /// Copied from a folder the user picked.
    Local,
}

/// What an install records beside the plugin's files. `installed_at` tells
/// one install of an id from the next, so settings sync can tell a plugin
/// removed elsewhere from one reinstalled here.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallMarker {
    pub(crate) source: InstallSource,
    pub(crate) installed_at: u64,
}

/// Record the install. Written after every declared file, so it describes
/// a complete install, and under a name no manifest may declare.
fn write_install_marker(dest: &Path, source: InstallSource) -> Result<(), String> {
    let installed_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let marker = InstallMarker {
        source,
        installed_at,
    };
    let json = serde_json::to_vec(&marker).map_err(|e| format!("cannot record install: {e}"))?;
    fs::write(dest.join(INSTALL_MARKER), json).map_err(|e| format!("cannot record install: {e}"))
}

/// The marker an install left in `dir`. `None` for a plugin installed before
/// markers existed, or one whose marker cannot be read.
pub(crate) fn read_install_marker(dir: &Path) -> Option<InstallMarker> {
    let bytes = fs::read(dir.join(INSTALL_MARKER)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

/// Read only a folder's manifest metadata, for the pre-install consent dialog.
pub(crate) fn inspect_dir(dir: &Path) -> Result<PluginInspection, String> {
    let manifest_json = fs::read_to_string(dir.join("manifest.json"))
        .map_err(|e| format!("not a plugin folder (no manifest.json): {e}"))?;
    let info = parse_manifest(&manifest_json)?;
    Ok(PluginInspection {
        id: info.id,
        name: info.name,
        version: info.version,
        description: info.description,
        permissions: info.permissions,
        sandbox: info.sandbox,
    })
}

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
    // A validated relative path joined onto dest always has a parent.
    let parent = target.parent().unwrap_or(dest);
    fs::create_dir_all(parent).map_err(|e| format!("cannot create {}: {e}", parent.display()))?;
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
    write_install_marker(&dest, InstallSource::Local)?;
    read_plugin_dir(&dest)
}

type Package<'a> = zip::ZipArchive<std::io::Cursor<&'a [u8]>>;

/// Open a package and read its manifest, validated, without writing anything.
fn open_package(bytes: &[u8]) -> Result<(Package<'_>, String, ManifestInfo), String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("not a valid plugin package: {e}"))?;
    let mut manifest_json = String::new();
    {
        use std::io::Read;
        let entry = archive
            .by_name("manifest.json")
            .map_err(|_| String::from("package has no manifest.json at its root"))?;
        entry
            .take(MAX_FILE_BYTES)
            .read_to_string(&mut manifest_json)
            .map_err(|e| format!("cannot read manifest.json from package: {e}"))?;
    }
    let info = parse_manifest(&manifest_json)?;
    Ok((archive, manifest_json, info))
}

/// The validated manifest of a package, for the checks an install runs
/// before it writes.
pub(crate) fn read_package_manifest(bytes: &[u8]) -> Result<ManifestInfo, String> {
    open_package(bytes).map(|(_, _, info)| info)
}

/// Install a downloaded plugin package, a zip the registry fetch has verified
/// (see `registry.rs`). The archive is never extracted wholesale: the
/// manifest inside declares the plugin's files, only those are copied out,
/// and a declared file missing from the archive fails the install. Size caps
/// keep a hostile archive from filling the disk, and an entry is read no
/// further than the size its header declares, so a deflate bomb stops at the
/// cap instead of unpacking into memory.
pub(crate) fn install_package(root: &Path, bytes: &[u8]) -> Result<InstalledPlugin, String> {
    let (mut archive, manifest_json, info) = open_package(bytes)?;

    // Validate every declared entry (present, within size caps) before
    // anything touches disk, so a rejected package leaves nothing behind.
    let mut total: u64 = 0;
    for rel in info.install_files() {
        let entry = archive
            .by_name(&rel)
            .map_err(|_| format!("declared plugin file \"{rel}\" is missing from the package"))?;
        if entry.size() > MAX_FILE_BYTES {
            return Err(format!("plugin file \"{rel}\" exceeds the size limit"));
        }
        total += entry.size();
        if total > MAX_TOTAL_BYTES {
            return Err(String::from("plugin package exceeds the total size limit"));
        }
    }

    let dest = root.join(&info.id);
    fs::create_dir_all(&dest).map_err(|e| format!("cannot create {}: {e}", dest.display()))?;
    fs::write(dest.join("manifest.json"), &manifest_json)
        .map_err(|e| format!("cannot write manifest.json: {e}"))?;

    for rel in info.install_files() {
        use std::io::Read;
        let entry = archive
            .by_name(&rel)
            .map_err(|_| format!("declared plugin file \"{rel}\" is missing from the package"))?;
        let declared = entry.size();
        let mut bytes = Vec::with_capacity(declared as usize);
        entry
            .take(declared + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| format!("cannot read {rel} from package: {e}"))?;
        if bytes.len() as u64 > declared {
            return Err(format!(
                "plugin file \"{rel}\" is larger than its header declares"
            ));
        }
        write_plugin_file(&dest, &rel, &bytes)?;
    }
    write_install_marker(&dest, InstallSource::Marketplace)?;
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

#[cfg(test)]
mod tests {
    use super::super::test_support::*;
    use super::*;

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
    fn inspect_dir_reads_metadata_only() {
        let root = temp_root("inspect");
        let dir = root.join("com.x.demo");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("manifest.json"),
            r#"{"id":"com.x.demo","name":"Demo","version":"1.0.0","apiVersion":"^1.0.0","permissions":["workspace:read"],"sandbox":false}"#,
        )
        .unwrap();
        // No main.js on disk: inspection must not need the entry source.
        let inspection = inspect_dir(&dir).unwrap();
        assert_eq!(inspection.id, "com.x.demo");
        assert_eq!(inspection.permissions, ["workspace:read"]);
        assert!(!inspection.sandbox);

        assert!(inspect_dir(&root.join("missing")).is_err());
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
    fn installs_record_their_source_after_the_plugins_files() {
        let root = temp_root("marker_root");
        let src = temp_root("marker_src");
        write_plugin(&src, "com.x.local", "export default {};");
        install_into(&root, &src).unwrap();
        let local = read_install_marker(&root.join("com.x.local")).unwrap();
        assert_eq!(local.source, InstallSource::Local);

        let bytes = zip_of(&[
            ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
            ("main.js", b"export default {};"),
            ("assets/data.txt", b"data"),
        ]);
        install_package(&root, &bytes).unwrap();
        let first = read_install_marker(&root.join("com.x.pkg")).unwrap();
        assert_eq!(first.source, InstallSource::Marketplace);

        // A reinstall is a new install: settings sync tells the two apart.
        install_package(&root, &bytes).unwrap();
        let second = read_install_marker(&root.join("com.x.pkg")).unwrap();
        assert_ne!(first.installed_at, second.installed_at);

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&src);
    }

    #[test]
    fn a_missing_or_unreadable_marker_reads_as_none() {
        let root = temp_root("marker_none");
        let dir = root.join("com.x.old");
        write_plugin(&dir, "com.x.old", "export default {};");
        assert_eq!(read_install_marker(&dir), None);
        fs::write(dir.join(INSTALL_MARKER), "not json").unwrap();
        assert_eq!(read_install_marker(&dir), None);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_package_rejects_an_oversized_file_before_writing_anything() {
        let root = temp_root("pkg_cap_file");
        // Deflated zeros compress to almost nothing, but entry.size() reports the
        // real uncompressed size, which is what the cap checks.
        let big = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
        let bytes = zip_with(
            zip::CompressionMethod::Deflated,
            &[
                ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
                ("main.js", b"export default {};"),
                ("assets/data.txt", &big),
            ],
        );

        let err = install_package(&root, &bytes).unwrap_err();
        assert!(err.contains("size limit"), "unexpected error: {err}");
        assert!(
            !root.join("com.x.pkg").exists(),
            "a rejected package must leave nothing on disk"
        );
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_package_rejects_when_the_total_exceeds_the_cap() {
        let root = temp_root("pkg_cap_total");
        let manifest = r#"{"id":"com.x.pkg","name":"Pkg","version":"1.0.0","apiVersion":"0.16.0","files":["main.js","a.bin","b.bin"]}"#;
        // Each file sits exactly at the per-file cap, so only the running total trips.
        let at_cap = vec![0u8; MAX_FILE_BYTES as usize];
        let bytes = zip_with(
            zip::CompressionMethod::Deflated,
            &[
                ("manifest.json", manifest.as_bytes()),
                ("main.js", &at_cap),
                ("a.bin", &at_cap),
                ("b.bin", &at_cap),
            ],
        );

        let err = install_package(&root, &bytes).unwrap_err();
        assert!(err.contains("total size limit"), "unexpected error: {err}");
        assert!(!root.join("com.x.pkg").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_package_reports_a_file_colliding_with_an_asset_directory() {
        let root = temp_root("pkg_dir_collision");
        // A file already sits where the package's assets/ directory must go.
        fs::create_dir_all(root.join("com.x.pkg")).unwrap();
        fs::write(root.join("com.x.pkg").join("assets"), "in the way").unwrap();
        let bytes = zip_of(&[
            ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
            ("main.js", b"export default {};"),
            ("assets/data.txt", b"payload"),
        ]);

        let err = install_package(&root, &bytes).unwrap_err();
        assert!(err.contains("cannot create"), "unexpected error: {err}");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn install_package_reports_an_unwritable_declared_file() {
        let root = temp_root("pkg_write_collision");
        // A directory sits exactly where the entry file must be written.
        fs::create_dir_all(root.join("com.x.pkg").join("main.js")).unwrap();
        let bytes = zip_of(&[
            ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
            ("main.js", b"export default {};"),
            ("assets/data.txt", b"payload"),
        ]);

        let err = install_package(&root, &bytes).unwrap_err();
        assert!(err.contains("cannot write"), "unexpected error: {err}");
        let _ = fs::remove_dir_all(&root);
    }

    /// A deflate entry whose header understates its size would otherwise
    /// unpack past the cap into memory: the read stops at the declared size.
    #[test]
    fn install_package_stops_reading_an_entry_at_the_size_its_header_declares() {
        let root = temp_root("pkg_header_lies");
        let payload = vec![b'a'; 4096];
        let mut bytes = zip_with(
            zip::CompressionMethod::Deflated,
            &[
                ("manifest.json", PACKAGED_MANIFEST.as_bytes()),
                ("main.js", &payload),
                ("assets/data.txt", b"x"),
            ],
        );
        // Rewrite the uncompressed size of `main.js` in both its local header
        // and its central directory record to 16 bytes.
        let patched = patch_uncompressed_size(&mut bytes, b"main.js", 16);
        assert_eq!(patched, 2, "local header and central directory");

        let err = install_package(&root, &bytes).unwrap_err();
        // zip 9 refuses the entry itself ("larger than its declared
        // uncompressed size"); the cap here stays as the second line.
        assert!(err.contains("larger than its"), "{err}");
        assert!(!root.join("com.x.pkg").join("main.js").exists());
        let _ = fs::remove_dir_all(&root);
    }

    /// Patch the uncompressed-size field of every header naming `name`.
    /// Local headers carry it at offset 22, central directory records at 24.
    fn patch_uncompressed_size(bytes: &mut [u8], name: &[u8], size: u32) -> usize {
        let mut patched = 0;
        for (signature, size_at, name_len_at) in [
            ([0x50, 0x4b, 0x03, 0x04], 22, 26),
            ([0x50, 0x4b, 0x01, 0x02], 24, 28),
        ] {
            let mut at = 0;
            while let Some(found) = bytes[at..].windows(4).position(|w| w == signature) {
                let header = at + found;
                let name_len = u16::from_le_bytes([
                    bytes[header + name_len_at],
                    bytes[header + name_len_at + 1],
                ]) as usize;
                let name_at = header + if size_at == 22 { 30 } else { 46 };
                if &bytes[name_at..name_at + name_len] == name {
                    bytes[header + size_at..header + size_at + 4]
                        .copy_from_slice(&size.to_le_bytes());
                    patched += 1;
                }
                at = header + 4;
            }
        }
        patched
    }

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
        // A core plugin ships in the app bundle, so nothing may serve bytes
        // for one out of the community store.
        assert!(read_asset_from(&root, "glyph.core.d2", "main.js").is_err());
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
    fn install_and_uninstall_refuse_a_core_plugin_id() {
        let root = temp_root("core_id");
        let src = temp_root("core_id_src");
        write_plugin(&src, "glyph.core.d2", "export default {}");

        let err = install_into(&root, &src).unwrap_err();
        assert!(err.contains("reserved for core plugins"), "{err}");
        assert!(!root.join("glyph.core.d2").exists());
        assert!(uninstall_from(&root, "glyph.core.d2").is_err());

        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&src);
    }
}
