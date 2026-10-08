//! On-disk per-workspace config under `.glyph/`.
//!
//! A workspace keeps its Glyph-managed state inside itself so it travels with
//! a `git clone` and survives move / rename — unlike the old absolute-path
//! keyed global store. Two files:
//!
//! - `.glyph/config.json`: **committed**. Durable settings: cloud sync (the
//!   source of truth that replaces the in-memory `SyncState` map) and daily
//!   notes.
//! - `.glyph/state.json` — **git-ignored** (via a `.glyph/.gitignore` we
//!   write). Volatile per-machine state (the last-opened file) that would
//!   otherwise churn sync history on every file switch.
//!
//! All stored paths are workspace-relative and forward-slash normalized (see
//! [`super::paths`]) so they stay valid across machines and on Windows.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[cfg(desktop)]
use crate::sync::WorkspaceSyncConfig;
use crate::sync::{BackendKind, CommitIdentity, ConflictPolicy};

const CONFIG_FILE: &str = "config.json";
const STATE_FILE: &str = "state.json";
const GITIGNORE_FILE: &str = ".gitignore";

fn default_version() -> u32 {
    1
}

/// Shape of the committed `.glyph/config.json`. Holds only Glyph-managed,
/// durable per-workspace settings; never an absolute path (the workspace root is
/// implied by the file's location).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceConfig {
    /// Schema version, for forward-compatible migrations. Starts at 1.
    #[serde(default = "default_version")]
    pub version: u32,
    /// Cloud-sync settings, or `None` when sync isn't configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sync: Option<SyncSettings>,
    /// Daily-notes settings, or `None` until the user saves them (the
    /// defaults apply meanwhile).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub daily_notes: Option<DailyNotesSettings>,
}

impl Default for WorkspaceConfig {
    fn default() -> Self {
        Self {
            version: 1,
            sync: None,
            daily_notes: None,
        }
    }
}

/// Where a day's note lives and what a new one starts from. Paths are
/// workspace-relative; the frontend turns the pattern's date tokens into a
/// file name.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DailyNotesSettings {
    /// Empty means the workspace root.
    pub folder: String,
    pub filename_pattern: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub template: Option<String>,
}

impl Default for DailyNotesSettings {
    fn default() -> Self {
        Self {
            folder: "daily".to_string(),
            filename_pattern: "YYYY-MM-DD.md".to_string(),
            template: None,
        }
    }
}

/// Sync settings as stored on disk: a [`WorkspaceSyncConfig`] minus its
/// `workspace_path` (implied by the file location).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncSettings {
    pub backend: BackendKind,
    pub remote_url: String,
    pub remote_branch: String,
    pub conflict_policy: ConflictPolicy,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<CommitIdentity>,
}

impl SyncSettings {
    #[cfg(desktop)]
    fn from_workspace(c: &WorkspaceSyncConfig) -> Self {
        Self {
            backend: c.backend,
            remote_url: c.remote_url.clone(),
            remote_branch: c.remote_branch.clone(),
            conflict_policy: c.conflict_policy,
            author: c.author.clone(),
        }
    }

    #[cfg(desktop)]
    fn into_workspace(self, workspace_path: String) -> WorkspaceSyncConfig {
        WorkspaceSyncConfig {
            workspace_path,
            backend: self.backend,
            remote_url: self.remote_url,
            remote_branch: self.remote_branch,
            conflict_policy: self.conflict_policy,
            author: self.author,
        }
    }
}

/// Shape of the git-ignored `.glyph/state.json`: per-machine volatile bits.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceState {
    #[serde(default = "default_version")]
    pub version: u32,
    /// Last file the user had open, RELATIVE to the workspace root, forward
    /// slash. `None` until a file is opened in this workspace.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_file: Option<String>,
}

fn glyph_dir(workspace_root: &Path) -> std::path::PathBuf {
    workspace_root.join(format!(".{}", crate::APP_NAME))
}

/// Read `.glyph/config.json`. `Ok(None)` when the file is absent (a workspace
/// that's never been configured — not an error); `Err` only when a file
/// exists but can't be read or parsed.
pub fn read_config(workspace_root: &Path) -> Result<Option<WorkspaceConfig>, String> {
    let path = glyph_dir(workspace_root).join(CONFIG_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s)
            .map(Some)
            .map_err(|e| format!("corrupt .glyph/config.json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("failed to read .glyph/config.json: {e}")),
    }
}

/// Write `.glyph/config.json`, creating `.glyph/` (and its `.gitignore`)
/// if needed. Pretty-printed with a trailing newline for clean diffs.
pub fn write_config(workspace_root: &Path, config: &WorkspaceConfig) -> Result<(), String> {
    let dir = glyph_dir(workspace_root);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create .glyph: {e}"))?;
    ensure_gitignore(&dir)?;
    let mut json = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    json.push('\n');
    fs::write(dir.join(CONFIG_FILE), json)
        .map_err(|e| format!("failed to write .glyph/config.json: {e}"))
}

/// Read `.glyph/state.json`, defaulting when absent.
pub fn read_state(workspace_root: &Path) -> Result<WorkspaceState, String> {
    let path = glyph_dir(workspace_root).join(STATE_FILE);
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("corrupt .glyph/state.json: {e}")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(WorkspaceState::default()),
        Err(e) => Err(format!("failed to read .glyph/state.json: {e}")),
    }
}

/// Write `.glyph/state.json`, creating `.glyph/` (and its `.gitignore`) if
/// needed.
pub fn write_state(workspace_root: &Path, state: &WorkspaceState) -> Result<(), String> {
    let dir = glyph_dir(workspace_root);
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create .glyph: {e}"))?;
    ensure_gitignore(&dir)?;
    let mut json = serde_json::to_string_pretty(state)
        .map_err(|e| format!("failed to serialize state: {e}"))?;
    json.push('\n');
    fs::write(dir.join(STATE_FILE), json)
        .map_err(|e| format!("failed to write .glyph/state.json: {e}"))
}

/// Ensure `.glyph/.gitignore` excludes the volatile `state.json` so it
/// never enters a commit, even though `.glyph/` itself is committed. Does
/// not clobber an existing (possibly user-edited) `.gitignore`.
fn ensure_gitignore(glyph_dir: &Path) -> Result<(), String> {
    let path = glyph_dir.join(GITIGNORE_FILE);
    if path.exists() {
        return Ok(());
    }
    fs::write(&path, format!("{STATE_FILE}\n"))
        .map_err(|e| format!("failed to write .glyph/.gitignore: {e}"))
}

// --- Sync-facing helpers (used by `crate::sync`) -----------------------

/// Load the sync config for the workspace at `root`, reconstructing a full
/// [`WorkspaceSyncConfig`] by injecting the absolute root. `None` when the
/// workspace has no `.glyph/config.json` or no sync block.
#[cfg(desktop)]
pub fn load_sync_config(root: &str) -> Result<Option<WorkspaceSyncConfig>, String> {
    let cfg = read_config(Path::new(root))?;
    Ok(cfg
        .and_then(|c| c.sync)
        .map(|s| s.into_workspace(root.to_string())))
}

/// Persist `config`'s sync settings into the workspace's `.glyph/config.json`,
/// preserving the version and any other (future) blocks already present.
#[cfg(desktop)]
pub fn store_sync_config(config: &WorkspaceSyncConfig) -> Result<(), String> {
    let root = Path::new(&config.workspace_path);
    let mut vc = read_config(root)?.unwrap_or_default();
    vc.sync = Some(SyncSettings::from_workspace(config));
    write_config(root, &vc)
}

/// Drop the sync block (sync disabled) while keeping the file and version.
/// No-op when the workspace has no config file yet.
#[cfg(desktop)]
pub fn clear_sync_config(root: &str) -> Result<(), String> {
    let path = Path::new(root);
    let Some(mut vc) = read_config(path)? else {
        return Ok(());
    };
    vc.sync = None;
    write_config(path, &vc)
}

// --- Daily notes ---------------------------------------------------------

/// The workspace's daily-notes settings, or the defaults when none are saved.
pub fn load_daily_notes(workspace_root: &Path) -> Result<DailyNotesSettings, String> {
    Ok(read_config(workspace_root)?
        .and_then(|c| c.daily_notes)
        .unwrap_or_default())
}

/// Persist the daily-notes settings, keeping the config's other blocks.
pub fn store_daily_notes(
    workspace_root: &Path,
    settings: DailyNotesSettings,
) -> Result<(), String> {
    let mut vc = read_config(workspace_root)?.unwrap_or_default();
    vc.daily_notes = Some(settings);
    write_config(workspace_root, &vc)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn sample_config(workspace: &str) -> WorkspaceSyncConfig {
        WorkspaceSyncConfig {
            workspace_path: workspace.to_string(),
            backend: BackendKind::Git,
            remote_url: "https://example.com/n.git".to_string(),
            remote_branch: "main".to_string(),
            conflict_policy: ConflictPolicy::PreferLocal,
            author: Some(CommitIdentity {
                name: "Hamid".into(),
                email: "h@example.com".into(),
            }),
        }
    }

    #[test]
    fn config_round_trips_with_camel_case_keys() {
        let tmp = TempDir::new().unwrap();
        store_sync_config(&sample_config(&tmp.path().to_string_lossy())).unwrap();

        let raw = std::fs::read_to_string(tmp.path().join(".glyph/config.json")).unwrap();
        assert!(raw.contains("\"remoteUrl\""));
        assert!(raw.contains("\"conflictPolicy\""));
        // The implied root is never written to disk.
        assert!(!raw.contains("workspacePath"));

        let loaded = load_sync_config(&tmp.path().to_string_lossy())
            .unwrap()
            .unwrap();
        // workspace_path is injected back from the location.
        assert_eq!(loaded.workspace_path, tmp.path().to_string_lossy());
        assert_eq!(loaded.remote_url, "https://example.com/n.git");
        assert_eq!(loaded.conflict_policy, ConflictPolicy::PreferLocal);
    }

    #[test]
    fn load_sync_config_is_none_when_absent() {
        let tmp = TempDir::new().unwrap();
        assert!(load_sync_config(&tmp.path().to_string_lossy())
            .unwrap()
            .is_none());
    }

    #[test]
    fn read_config_errors_on_corrupt_file() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        std::fs::write(tmp.path().join(".glyph/config.json"), "{not json").unwrap();
        assert!(read_config(tmp.path()).is_err());
    }

    #[test]
    fn write_config_creates_gitignore_excluding_state() {
        let tmp = TempDir::new().unwrap();
        store_sync_config(&sample_config(&tmp.path().to_string_lossy())).unwrap();
        let ignore = std::fs::read_to_string(tmp.path().join(".glyph/.gitignore")).unwrap();
        assert!(ignore.contains("state.json"));
    }

    #[test]
    fn ensure_gitignore_does_not_clobber_existing() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        std::fs::write(tmp.path().join(".glyph/.gitignore"), "state.json\ncustom\n").unwrap();
        store_sync_config(&sample_config(&tmp.path().to_string_lossy())).unwrap();
        let ignore = std::fs::read_to_string(tmp.path().join(".glyph/.gitignore")).unwrap();
        assert!(ignore.contains("custom"));
    }

    #[test]
    fn clear_sync_config_drops_sync_but_keeps_file() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        store_sync_config(&sample_config(&root)).unwrap();
        clear_sync_config(&root).unwrap();
        assert!(load_sync_config(&root).unwrap().is_none());
        // The file (and version) is still there.
        assert!(read_config(tmp.path()).unwrap().is_some());
    }

    #[test]
    fn clear_sync_config_is_noop_when_absent() {
        let tmp = TempDir::new().unwrap();
        clear_sync_config(&tmp.path().to_string_lossy()).unwrap();
    }

    #[test]
    fn daily_notes_default_until_saved() {
        let tmp = TempDir::new().unwrap();
        let defaults = load_daily_notes(tmp.path()).unwrap();
        assert_eq!(defaults.folder, "daily");
        assert_eq!(defaults.filename_pattern, "YYYY-MM-DD.md");
        assert_eq!(defaults.template, None);
        // Reading the defaults never materializes `.glyph/`.
        assert!(!tmp.path().join(".glyph").exists());
    }

    #[test]
    fn daily_notes_round_trip_with_camel_case_keys() {
        let tmp = TempDir::new().unwrap();
        let settings = DailyNotesSettings {
            folder: "journal".into(),
            filename_pattern: "YYYY/MM-DD.md".into(),
            template: Some("templates/daily.md".into()),
        };
        store_daily_notes(tmp.path(), settings.clone()).unwrap();

        let raw = std::fs::read_to_string(tmp.path().join(".glyph/config.json")).unwrap();
        assert!(raw.contains("\"dailyNotes\""));
        assert!(raw.contains("\"filenamePattern\""));
        assert_eq!(load_daily_notes(tmp.path()).unwrap(), settings);
    }

    #[test]
    fn daily_notes_fill_missing_keys_with_defaults() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        std::fs::write(
            tmp.path().join(".glyph/config.json"),
            r#"{"dailyNotes":{"folder":""}}"#,
        )
        .unwrap();
        let loaded = load_daily_notes(tmp.path()).unwrap();
        // An explicit empty folder (the workspace root) is kept, not defaulted.
        assert_eq!(loaded.folder, "");
        assert_eq!(loaded.filename_pattern, "YYYY-MM-DD.md");
    }

    #[test]
    fn daily_notes_and_sync_blocks_survive_each_other() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let settings = DailyNotesSettings {
            folder: "journal".into(),
            ..DailyNotesSettings::default()
        };

        store_sync_config(&sample_config(&root)).unwrap();
        store_daily_notes(tmp.path(), settings.clone()).unwrap();
        assert!(load_sync_config(&root).unwrap().is_some());

        store_sync_config(&sample_config(&root)).unwrap();
        assert_eq!(load_daily_notes(tmp.path()).unwrap(), settings);

        clear_sync_config(&root).unwrap();
        assert_eq!(load_daily_notes(tmp.path()).unwrap(), settings);
    }

    #[test]
    fn daily_notes_refuse_to_overwrite_a_corrupt_config() {
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        std::fs::write(tmp.path().join(".glyph/config.json"), "{not json").unwrap();

        assert!(load_daily_notes(tmp.path()).is_err());
        assert!(store_daily_notes(tmp.path(), DailyNotesSettings::default()).is_err());
        let raw = std::fs::read_to_string(tmp.path().join(".glyph/config.json")).unwrap();
        assert_eq!(raw, "{not json");
    }

    #[test]
    fn state_round_trips_and_defaults_when_absent() {
        let tmp = TempDir::new().unwrap();
        assert_eq!(read_state(tmp.path()).unwrap(), WorkspaceState::default());

        let state = WorkspaceState {
            version: 1,
            last_file: Some("notes/todo.md".into()),
        };
        write_state(tmp.path(), &state).unwrap();
        let raw = std::fs::read_to_string(tmp.path().join(".glyph/state.json")).unwrap();
        assert!(raw.contains("\"lastFile\""));
        assert_eq!(read_state(tmp.path()).unwrap(), state);
    }

    #[test]
    fn version_defaults_when_absent_in_json() {
        // A file written without a `version` key falls back to the schema
        // default via `default_version` instead of erroring.
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph")).unwrap();
        std::fs::write(tmp.path().join(".glyph/config.json"), "{}").unwrap();
        assert_eq!(read_config(tmp.path()).unwrap().unwrap().version, 1);
        std::fs::write(tmp.path().join(".glyph/state.json"), "{}").unwrap();
        assert_eq!(read_state(tmp.path()).unwrap().version, 1);
    }

    #[test]
    fn read_errors_when_the_file_is_unreadable() {
        // Present but a directory: read fails with something other than
        // NotFound, surfacing an Err rather than the "absent => Ok" path.
        let tmp = TempDir::new().unwrap();
        std::fs::create_dir_all(tmp.path().join(".glyph/config.json")).unwrap();
        assert!(read_config(tmp.path()).is_err());
        std::fs::create_dir_all(tmp.path().join(".glyph/state.json")).unwrap();
        assert!(read_state(tmp.path()).is_err());
    }
}
