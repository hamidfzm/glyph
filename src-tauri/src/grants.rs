//! Backend-managed filesystem grants: every filesystem command validates its
//! path against this registry. Grants are minted only from backend-observed
//! events (CLI args, drag-and-drop, native dialogs), never from a bare
//! webview-supplied path. See docs/security/threat-model.md.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Managed state holding every path the webview may touch this session.
#[derive(Default)]
pub struct GrantRegistry {
    inner: Mutex<Grants>,
}

#[derive(Default)]
struct Grants {
    /// Open workspace roots: recursive read + write.
    workspaces: HashSet<PathBuf>,
    /// Explicitly opened loose files: exact-path read, write (autosave), watch.
    files: HashSet<PathBuf>,
    /// Approved export destination folders: recursive write only.
    export_dirs: HashSet<PathBuf>,
    /// Approved single-file export targets: exact-path write only.
    export_files: HashSet<PathBuf>,
    /// Folder picked for a plugin install, consumed once by `install_plugin`.
    pending_plugin_dir: Option<PathBuf>,
}

/// Denials echo only the requested path, never the grant list.
fn denied(path: &Path) -> String {
    format!(
        "path is outside the allowed workspaces and files: {}",
        path.display()
    )
}

/// Canonicalize tolerating a not-yet-existing tail; a `..` or `.` in the
/// missing tail makes `file_name()` return `None` and is rejected.
fn canonicalize_lenient(path: &Path) -> Result<PathBuf, String> {
    if let Ok(canonical) = path.canonicalize() {
        return Ok(canonical);
    }
    let parent = path.parent().ok_or_else(|| denied(path))?;
    let name = path.file_name().ok_or_else(|| denied(path))?;
    Ok(canonicalize_lenient(parent)?.join(name))
}

impl GrantRegistry {
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Grants>, String> {
        self.inner.lock().map_err(|e| format!("Lock error: {e}"))
    }

    /// Grant recursive read + write on an existing workspace root.
    pub fn grant_workspace(&self, root: &Path) -> Result<PathBuf, String> {
        let canonical = root.canonicalize().map_err(|_| denied(root))?;
        self.lock()?.workspaces.insert(canonical.clone());
        Ok(canonical)
    }

    /// Not wired to any command yet: grants stay session-scoped; kept as the
    /// API for a future explicit-revoke flow.
    #[cfg_attr(not(test), allow(dead_code))]
    pub fn revoke_workspace(&self, root: &Path) {
        if let Ok(canonical) = root.canonicalize() {
            if let Ok(mut grants) = self.lock() {
                grants.workspaces.remove(&canonical);
            }
        }
    }

    /// Grant exact-path read + write + watch on an existing loose file.
    pub fn grant_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = path.canonicalize().map_err(|_| denied(path))?;
        self.lock()?.files.insert(canonical.clone());
        Ok(canonical)
    }

    /// Grant recursive write on an export destination folder (may not exist yet).
    pub fn grant_export_dir(&self, dir: &Path) -> Result<PathBuf, String> {
        let canonical = canonicalize_lenient(dir)?;
        self.lock()?.export_dirs.insert(canonical.clone());
        Ok(canonical)
    }

    /// Grant exact-path write on a single export target (may not exist yet).
    pub fn grant_export_file(&self, path: &Path) -> Result<PathBuf, String> {
        let canonical = canonicalize_lenient(path)?;
        self.lock()?.export_files.insert(canonical.clone());
        Ok(canonical)
    }

    /// Export grants are write-only and deliberately do not count as readable.
    pub fn ensure_readable(&self, path: &str) -> Result<PathBuf, String> {
        let requested = Path::new(path);
        let canonical = canonicalize_lenient(requested)?;
        let grants = self.lock()?;
        if grants.files.contains(&canonical)
            || grants.workspaces.iter().any(|w| canonical.starts_with(w))
        {
            Ok(canonical)
        } else {
            Err(denied(requested))
        }
    }

    pub fn ensure_writable(&self, path: &str) -> Result<PathBuf, String> {
        let requested = Path::new(path);
        let canonical = canonicalize_lenient(requested)?;
        let grants = self.lock()?;
        if grants.files.contains(&canonical)
            || grants.export_files.contains(&canonical)
            || grants.workspaces.iter().any(|w| canonical.starts_with(w))
            || grants.export_dirs.iter().any(|d| canonical.starts_with(d))
        {
            Ok(canonical)
        } else {
            Err(denied(requested))
        }
    }

    /// Watching follows the read rule.
    pub fn ensure_watchable(&self, path: &str) -> Result<PathBuf, String> {
        self.ensure_readable(path)
    }

    /// Require `root` to be exactly a granted workspace root, not a path inside one.
    pub fn ensure_workspace(&self, root: &str) -> Result<PathBuf, String> {
        let requested = Path::new(root);
        let canonical = requested.canonicalize().map_err(|_| denied(requested))?;
        if self.lock()?.workspaces.contains(&canonical) {
            Ok(canonical)
        } else {
            Err(denied(requested))
        }
    }

    pub fn set_pending_plugin_dir(&self, dir: PathBuf) {
        if let Ok(mut grants) = self.lock() {
            grants.pending_plugin_dir = Some(dir);
        }
    }

    /// Consume the pending plugin-install folder (one install per pick).
    pub fn take_pending_plugin_dir(&self) -> Option<PathBuf> {
        self.lock().ok()?.pending_plugin_dir.take()
    }

    /// Seed grants from the persisted settings store (open tabs, recent files);
    /// absent keys, corrupt JSON, and deleted paths silently stay denied.
    ///
    /// Trust note: settings.json is renderer-writable, so it can stage grants for
    /// the next launch; that matches the trust it already carries (see docs/security/threat-model.md).
    pub fn seed_from_settings_json(&self, raw: &str) -> (Vec<PathBuf>, Vec<PathBuf>) {
        let mut workspaces = Vec::new();
        let mut files = Vec::new();
        let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
            return (workspaces, files);
        };
        let behavior = &value["settings"]["behavior"];
        if let Some(tabs) = behavior["openTabs"].as_array() {
            for tab in tabs {
                let Some(path) = tab["path"].as_str() else {
                    continue;
                };
                match tab["kind"].as_str() {
                    // Graph tabs carry the workspace root as their path.
                    Some("folder") | Some("graph") => {
                        if let Ok(canonical) = self.grant_workspace(Path::new(path)) {
                            workspaces.push(canonical);
                        }
                    }
                    Some("file") => {
                        if let Ok(canonical) = self.grant_file(Path::new(path)) {
                            files.push(canonical);
                        }
                    }
                    _ => {}
                }
            }
        }
        if let Some(recent) = behavior["recentFiles"].as_array() {
            for entry in recent {
                if let Some(path) = entry.as_str() {
                    if let Ok(canonical) = self.grant_file(Path::new(path)) {
                        files.push(canonical);
                    }
                }
            }
        }
        (workspaces, files)
    }
}

/// Mirror a directory read grant into the asset-protocol scope; failure is
/// ignored because the protocol keeps denying, which fails closed.
pub fn allow_asset_dir<R: tauri::Runtime>(app: &tauri::AppHandle<R>, dir: &Path) {
    use tauri::Manager;
    let _ = app.asset_protocol_scope().allow_directory(dir, true);
}

/// Mirror a single-file read grant into the runtime asset-protocol scope.
pub fn allow_asset_file<R: tauri::Runtime>(app: &tauri::AppHandle<R>, file: &Path) {
    use tauri::Manager;
    let _ = app.asset_protocol_scope().allow_file(file);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn as_str(path: &Path) -> String {
        path.to_string_lossy().to_string()
    }

    #[test]
    fn everything_is_denied_by_default() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        fs::write(&file, "x").unwrap();
        let grants = GrantRegistry::default();

        for result in [
            grants.ensure_readable(&as_str(&file)),
            grants.ensure_writable(&as_str(&file)),
            grants.ensure_watchable(&as_str(&file)),
            grants.ensure_workspace(&as_str(tmp.path())),
        ] {
            let err = result.expect_err("must be denied");
            assert!(
                err.starts_with("path is outside the allowed workspaces and files:"),
                "unexpected message: {err}"
            );
        }
    }

    #[test]
    fn workspace_grant_allows_nested_read_and_write() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("sub").join("deep");
        fs::create_dir_all(&nested).unwrap();
        let file = nested.join("note.md");
        fs::write(&file, "x").unwrap();

        let grants = GrantRegistry::default();
        grants.grant_workspace(tmp.path()).unwrap();

        assert!(grants.ensure_readable(&as_str(&file)).is_ok());
        assert!(grants.ensure_writable(&as_str(&file)).is_ok());
        assert!(grants.ensure_watchable(&as_str(tmp.path())).is_ok());
        assert!(grants.ensure_workspace(&as_str(tmp.path())).is_ok());
        // A path nested inside is not the workspace root itself.
        assert!(grants.ensure_workspace(&as_str(&nested)).is_err());
    }

    #[test]
    fn dot_dot_traversal_cannot_escape_a_workspace() {
        let outer = TempDir::new().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        let secret = outer.path().join("secret.md");
        fs::write(&secret, "x").unwrap();

        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();

        let sneaky = root.join("..").join("secret.md");
        assert!(grants.ensure_readable(&as_str(&sneaky)).is_err());
        // `root/sub/../note.md` resolves back inside and is fine.
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("note.md"), "x").unwrap();
        let inside = root.join("sub").join("..").join("note.md");
        assert!(grants.ensure_readable(&as_str(&inside)).is_ok());
    }

    #[test]
    fn missing_tail_with_dot_dot_is_denied() {
        let outer = TempDir::new().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();

        // `nope` does not exist, so the lenient fallback must reject the `..`
        // instead of textually appending it.
        let sneaky = root.join("nope").join("..").join("..").join("out.md");
        assert!(grants.ensure_writable(&as_str(&sneaky)).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_inside_a_workspace_cannot_escape_it() {
        let outer = TempDir::new().unwrap();
        let root = outer.path().join("ws");
        fs::create_dir_all(&root).unwrap();
        let secret = outer.path().join("secret.md");
        fs::write(&secret, "classified").unwrap();
        let link = root.join("innocent.md");
        std::os::unix::fs::symlink(&secret, &link).unwrap();

        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();

        assert!(grants.ensure_readable(&as_str(&link)).is_err());
    }

    #[test]
    fn revoked_workspace_is_denied_again() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        fs::write(&file, "x").unwrap();

        let grants = GrantRegistry::default();
        grants.grant_workspace(tmp.path()).unwrap();
        assert!(grants.ensure_readable(&as_str(&file)).is_ok());

        grants.revoke_workspace(tmp.path());
        assert!(grants.ensure_readable(&as_str(&file)).is_err());
        assert!(grants.ensure_workspace(&as_str(tmp.path())).is_err());
    }

    #[test]
    fn revoke_tolerates_missing_paths_and_a_poisoned_lock() {
        let tmp = TempDir::new().unwrap();
        let grants = GrantRegistry::default();
        grants.grant_workspace(tmp.path()).unwrap();

        grants.revoke_workspace(&tmp.path().join("never-existed"));
        assert!(grants.ensure_workspace(&as_str(tmp.path())).is_ok());

        // Poison the mutex on purpose: validators must fail closed, not allow.
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _guard = grants.inner.lock().unwrap();
            panic!("poison");
        }));
        grants.revoke_workspace(tmp.path());
        let err = grants.ensure_readable(&as_str(tmp.path())).unwrap_err();
        assert!(err.contains("Lock error"));
    }

    #[test]
    fn loose_file_grant_is_exact_and_read_write() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("open.md");
        let sibling = tmp.path().join("sibling.md");
        fs::write(&file, "x").unwrap();
        fs::write(&sibling, "x").unwrap();

        let grants = GrantRegistry::default();
        grants.grant_file(&file).unwrap();

        assert!(grants.ensure_readable(&as_str(&file)).is_ok());
        assert!(grants.ensure_writable(&as_str(&file)).is_ok());
        assert!(grants.ensure_watchable(&as_str(&file)).is_ok());
        assert!(grants.ensure_readable(&as_str(&sibling)).is_err());
        assert!(grants.ensure_writable(&as_str(&sibling)).is_err());
    }

    #[test]
    fn export_dir_is_recursively_writable_but_not_readable() {
        let tmp = TempDir::new().unwrap();
        let out = tmp.path().join("site");

        let grants = GrantRegistry::default();
        grants.grant_export_dir(&out).unwrap();

        let nested = out.join("assets").join("img.png");
        assert!(grants.ensure_writable(&as_str(&out)).is_ok());
        assert!(grants.ensure_writable(&as_str(&nested)).is_ok());
        assert!(grants.ensure_readable(&as_str(&out)).is_err());
        assert!(grants.ensure_readable(&as_str(&nested)).is_err());
    }

    #[test]
    fn export_file_grant_is_exact_write_only() {
        let tmp = TempDir::new().unwrap();
        let target = tmp.path().join("doc.pdf");
        let sibling = tmp.path().join("other.pdf");

        let grants = GrantRegistry::default();
        grants.grant_export_file(&target).unwrap();

        assert!(grants.ensure_writable(&as_str(&target)).is_ok());
        assert!(grants.ensure_writable(&as_str(&sibling)).is_err());
        assert!(grants.ensure_readable(&as_str(&target)).is_err());
    }

    #[test]
    fn grants_match_regardless_of_path_spelling() {
        // Both sides canonicalize, so the frontend's spelling (no Windows
        // verbatim prefix) still matches.
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        fs::write(&file, "x").unwrap();

        let grants = GrantRegistry::default();
        let canonical = grants.grant_workspace(tmp.path()).unwrap();
        assert!(grants.ensure_readable(&as_str(&file)).is_ok());
        assert!(grants.ensure_workspace(&as_str(&canonical)).is_ok());
    }

    #[test]
    fn grant_workspace_requires_an_existing_directory() {
        let tmp = TempDir::new().unwrap();
        let missing = tmp.path().join("not-here");
        let grants = GrantRegistry::default();
        assert!(grants.grant_workspace(&missing).is_err());
        assert!(grants.grant_file(&missing.join("a.md")).is_err());
    }

    #[test]
    fn pending_plugin_dir_is_consumed_once() {
        let grants = GrantRegistry::default();
        assert!(grants.take_pending_plugin_dir().is_none());
        grants.set_pending_plugin_dir(PathBuf::from("/plugins/src"));
        assert_eq!(
            grants.take_pending_plugin_dir(),
            Some(PathBuf::from("/plugins/src"))
        );
        assert!(grants.take_pending_plugin_dir().is_none());
    }

    #[test]
    fn seed_from_settings_json_grants_tabs_and_recent_files() {
        let tmp = TempDir::new().unwrap();
        let ws = tmp.path().join("ws");
        fs::create_dir_all(&ws).unwrap();
        fs::write(ws.join("inner.md"), "x").unwrap();
        let loose = tmp.path().join("loose.md");
        fs::write(&loose, "x").unwrap();
        let recent = tmp.path().join("recent.md");
        fs::write(&recent, "x").unwrap();
        let gone = tmp.path().join("gone.md");

        let raw = serde_json::json!({
            "settings": {
                "behavior": {
                    "openTabs": [
                        { "kind": "folder", "path": ws.to_string_lossy(), "expanded": [] },
                        { "kind": "file", "path": loose.to_string_lossy() },
                        { "kind": "graph", "path": ws.to_string_lossy() },
                        // Degenerate entries: missing path and an unknown kind.
                        { "kind": "file" },
                        { "kind": "hologram", "path": loose.to_string_lossy() },
                    ],
                    "recentFiles": [recent.to_string_lossy(), gone.to_string_lossy(), 42],
                }
            }
        })
        .to_string();

        let grants = GrantRegistry::default();
        let (workspaces, files) = grants.seed_from_settings_json(&raw);
        assert_eq!(workspaces.len(), 2, "folder + graph tabs");
        assert_eq!(files.len(), 2, "loose tab + one surviving recent file");

        assert!(grants
            .ensure_readable(&as_str(&ws.join("inner.md")))
            .is_ok());
        assert!(grants.ensure_readable(&as_str(&loose)).is_ok());
        assert!(grants.ensure_readable(&as_str(&recent)).is_ok());
        assert!(grants.ensure_readable(&as_str(&gone)).is_err());
    }

    #[test]
    fn seed_from_settings_json_tolerates_garbage() {
        let grants = GrantRegistry::default();
        for raw in [
            "",
            "not json",
            "{}",
            r#"{"settings":{}}"#,
            r#"{"settings":{"behavior":{"openTabs":"nope"}}}"#,
        ] {
            let (workspaces, files) = grants.seed_from_settings_json(raw);
            assert!(workspaces.is_empty());
            assert!(files.is_empty());
        }
    }

    #[test]
    fn ensure_readable_returns_the_canonical_path() {
        let tmp = TempDir::new().unwrap();
        let file = tmp.path().join("a.md");
        fs::write(&file, "x").unwrap();
        let grants = GrantRegistry::default();
        grants.grant_workspace(tmp.path()).unwrap();

        let resolved = grants.ensure_readable(&as_str(&file)).unwrap();
        assert_eq!(resolved, file.canonicalize().unwrap());
    }
}
