//! Native file/folder pickers run in Rust: the webview never supplies the path
//! that is granted; the user's choice is minted as a grant in [`GrantRegistry`].
//! Dialogs run on a blocking thread (the plugin's blocking API must not run on
//! the async runtime). Drives live OS dialogs, so excluded from codecov (see
//! codecov.yml).

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, FilePath};

use super::export::{settle_export_dir, ExportDirPick};
use crate::grants::{self, GrantRegistry};

/// File-open filter entry, mirroring the JS dialog plugin's shape.
#[derive(Deserialize)]
pub struct PickFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

fn to_path(picked: FilePath) -> Result<PathBuf, String> {
    picked.into_path().map_err(|e| e.to_string())
}

/// A dialog resolves its starting folder as it opens (on Windows, connecting to
/// a network path's host), so the renderer's must be a granted workspace.
fn ensure_start_dir<R: Runtime>(app: &AppHandle<R>, dir: Option<&str>) -> Result<(), String> {
    if let Some(dir) = dir {
        app.state::<GrantRegistry>().ensure_workspace(dir)?;
    }
    Ok(())
}

/// Open Folder: pick a directory and grant it as a workspace.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    let canonical = app.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(&app, &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// New Workspace: name a folder via a save dialog, create it, grant it as a
/// workspace. The create must precede the grant (grant_workspace needs it to exist).
#[tauri::command]
pub async fn pick_new_workspace<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
) -> Result<Option<String>, String> {
    let dialog = app.dialog().file().set_file_name(default_name);
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let canonical = app.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(&app, &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Open File(s): multi-select picker; each choice is granted as a loose file.
#[tauri::command]
pub async fn pick_files<R: Runtime>(
    app: AppHandle<R>,
    filters: Vec<PickFilter>,
) -> Result<Option<Vec<String>>, String> {
    let mut dialog = app.dialog().file();
    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_files())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let grants = app.state::<GrantRegistry>();
    let mut paths = Vec::with_capacity(picked.len());
    for file in picked {
        let path = to_path(file)?;
        let canonical = grants.grant_file(&path)?;
        grants::allow_asset_file(&app, &canonical);
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(Some(paths))
}

/// Save dialog. `default_dir` is the folder it opens in, when given. It is
/// passed on as spelled, not canonicalized: the dialog cannot open a
/// `\\?\UNC\` path.
async fn pick_save_target<R: Runtime>(
    app: &AppHandle<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    default_dir: Option<String>,
) -> Result<Option<PathBuf>, String> {
    ensure_start_dir(app, default_dir.as_deref())?;
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let mut dialog = app
        .dialog()
        .file()
        .set_file_name(default_name)
        .add_filter(filter_name, &exts);
    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_save_file())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    to_path(picked).map(Some)
}

/// Export save dialog: pick a destination file and grant it write-only.
#[tauri::command]
pub async fn pick_save<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let picked = pick_save_target(&app, default_name, filter_name, extensions, None).await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    app.state::<GrantRegistry>().grant_export_file(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Save As for a new document: the picked file is granted as Open File grants
/// one, so once written it reloads from disk and its relative images load.
#[tauri::command]
pub async fn pick_save_document<R: Runtime>(
    app: AppHandle<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let picked = pick_save_target(&app, default_name, filter_name, extensions, default_dir).await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let canonical = app.state::<GrantRegistry>().grant_document_target(&path)?;
    grants::allow_asset_file(&app, &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Website export: pick an output directory and grant it write-only, unless it
/// is inside `root`, the workspace being exported. Decided here on resolved
/// paths: the renderer can hold the two spelled differently (a symlink, a
/// mapped drive, a short name), so it cannot compare them.
#[tauri::command]
pub async fn pick_export_dir<R: Runtime>(
    app: AppHandle<R>,
    root: String,
) -> Result<Option<ExportDirPick>, String> {
    // `root` is the renderer's: checked before any dialog opens.
    let root = app.state::<GrantRegistry>().ensure_workspace(&root)?;
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    settle_export_dir(&app.state::<GrantRegistry>(), &to_path(picked)?, &root).map(Some)
}

/// Plugin install: the pick is stashed as the pending plugin dir (not a
/// workspace grant) and consumed by `install_plugin`.
#[tauri::command]
pub async fn pick_plugin_dir<R: Runtime>(app: AppHandle<R>) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    app.state::<GrantRegistry>()
        .set_pending_plugin_dir(path.clone());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// "Move to..." destination picker. No grant is minted; `move_path`
/// independently validates the destination against the workspace root.
#[tauri::command]
pub async fn pick_move_dir<R: Runtime>(
    app: AppHandle<R>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    ensure_start_dir(&app, default_dir.as_deref())?;
    let mut dialog = app.dialog().file();
    if let Some(dir) = default_dir {
        dialog = dialog.set_directory(dir);
    }
    let picked = tauri::async_runtime::spawn_blocking(move || dialog.blocking_pick_folder())
        .await
        .map_err(|e| e.to_string())?;
    match picked {
        Some(picked) => Ok(Some(to_path(picked)?.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::async_runtime::block_on;
    use tauri::test::{mock_app, MockRuntime};

    const DENIED: &str = "path is outside the allowed workspaces and files:";
    /// On Windows a network path is refused unresolved: looking it up would
    /// connect to the host it names. Elsewhere it is one more missing path.
    const REMOTE: &str = if cfg!(windows) {
        "never looked up"
    } else {
        DENIED
    };

    struct Fixture {
        _tmp: tempfile::TempDir,
        app: tauri::App<MockRuntime>,
        workspace: String,
        /// Paths that are not the granted workspace, each with its refusal.
        refused: Vec<(String, &'static str)>,
    }

    fn fixture() -> Fixture {
        let tmp = tempfile::TempDir::new().unwrap();
        let workspace = tmp.path().join("ws");
        std::fs::create_dir_all(workspace.join("sub")).unwrap();
        let app = mock_app();
        app.manage(GrantRegistry::default());
        app.state::<GrantRegistry>()
            .grant_workspace(&workspace)
            .unwrap();

        let local = |path: PathBuf| (path.to_string_lossy().to_string(), DENIED);
        let remote = |path: &str| (path.to_string(), REMOTE);
        let refused = vec![
            // An ungranted folder, one inside the workspace, one that is gone,
            // a relative name, and nothing at all.
            local(tmp.path().to_path_buf()),
            local(workspace.join("sub")),
            local(workspace.join("missing")),
            local(PathBuf::from("ws")),
            local(PathBuf::new()),
            // A host under `.invalid` cannot exist, should a refusal ever come late.
            remote(r"\\attacker.invalid\share\notes"),
            remote(r"\\?\UNC\attacker.invalid\share\notes"),
            remote(r"\??\UNC\attacker.invalid\share\notes"),
            remote(r"\\attacker.invalid\\share\notes"),
        ];
        Fixture {
            workspace: workspace.to_string_lossy().to_string(),
            _tmp: tmp,
            app,
            refused,
        }
    }

    /// The mock app has no dialog to open, so a refusal came before one.
    fn assert_refused<T: std::fmt::Debug>(picked: Result<T, String>, refusal: &str) {
        let denial = picked.expect_err("must be denied");
        assert!(denial.contains(refusal), "unexpected message: {denial}");
    }

    #[test]
    fn the_export_dir_picker_refuses_a_root_that_is_not_a_granted_workspace() {
        let fx = fixture();
        for (root, refusal) in &fx.refused {
            let picked = block_on(pick_export_dir(fx.app.handle().clone(), root.clone()));
            assert_refused(picked, refusal);
        }
    }

    #[test]
    fn the_document_save_picker_refuses_a_starting_folder_that_is_not_a_granted_workspace() {
        let fx = fixture();
        for (dir, refusal) in &fx.refused {
            let picked = block_on(pick_save_document(
                fx.app.handle().clone(),
                "Untitled-1.md".to_string(),
                "Markdown".to_string(),
                vec!["md".to_string()],
                Some(dir.clone()),
            ));
            assert_refused(picked, refusal);
        }
    }

    #[test]
    fn the_move_picker_refuses_a_starting_folder_that_is_not_a_granted_workspace() {
        let fx = fixture();
        for (dir, refusal) in &fx.refused {
            let picked = block_on(pick_move_dir(fx.app.handle().clone(), Some(dir.clone())));
            assert_refused(picked, refusal);
        }
    }

    #[test]
    fn a_granted_workspace_and_no_starting_folder_both_pass_the_check() {
        let fx = fixture();
        let app = fx.app.handle();
        assert_eq!(ensure_start_dir(app, Some(&fx.workspace)), Ok(()));
        assert_eq!(ensure_start_dir(app, None), Ok(()));
    }
}
