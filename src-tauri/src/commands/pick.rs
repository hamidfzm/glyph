//! Native file/folder pickers run in Rust: the webview never supplies the path
//! that is granted; the user's choice is minted as a grant in [`GrantRegistry`].
//! Each dialog is built by [`dialog_for`] for the window that asked and shown by
//! [`show`]. Drives live OS dialogs, so excluded from codecov (see codecov.yml).

use serde::Deserialize;
use std::path::PathBuf;
use tauri::{Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, FileDialogBuilder, FilePath};

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

/// A dialog for `window`, the one Tauri injects for the calling webview: on
/// Windows it owns the dialog and takes no input meanwhile, on macOS the
/// dialog is a sheet on it. Linux gets no parent: the GTK dialog backend never
/// reads one, and on X11 reading the display handle opens a connection that
/// is never closed.
///
/// `start_dir` is the renderer's and a dialog resolves it as it opens (on
/// Windows, connecting to a network path's host), so it must be a granted
/// workspace. It is passed on as spelled: the dialog cannot open `\\?\UNC\`.
fn dialog_for<R: Runtime>(
    window: &WebviewWindow<R>,
    start_dir: Option<String>,
) -> Result<FileDialogBuilder<R>, String> {
    if let Some(dir) = &start_dir {
        window.state::<GrantRegistry>().ensure_workspace(dir)?;
    }
    let mut dialog = window.dialog().file();
    #[cfg(any(windows, target_os = "macos"))]
    {
        dialog = dialog.set_parent(window);
    }
    if let Some(dir) = start_dir {
        dialog = dialog.set_directory(dir);
    }
    Ok(dialog)
}

/// Shows `dialog` and waits for the choice, `None` when cancelled. The
/// plugin's blocking API must not run on the async runtime.
async fn show<R: Runtime, T: Send + 'static>(
    dialog: FileDialogBuilder<R>,
    blocking: fn(FileDialogBuilder<R>) -> Option<T>,
) -> Result<Option<T>, String> {
    tauri::async_runtime::spawn_blocking(move || blocking(dialog))
        .await
        .map_err(|e| e.to_string())
}

/// Open Folder: pick a directory and grant it as a workspace.
#[tauri::command]
pub async fn pick_folder<R: Runtime>(window: WebviewWindow<R>) -> Result<Option<String>, String> {
    let dialog = dialog_for(&window, None)?;
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_pick_folder).await? else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    let canonical = window.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(window.app_handle(), &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// New Workspace: name a folder via a save dialog, create it, grant it as a
/// workspace. The create must precede the grant (grant_workspace needs it to exist).
#[tauri::command]
pub async fn pick_new_workspace<R: Runtime>(
    window: WebviewWindow<R>,
    default_name: String,
) -> Result<Option<String>, String> {
    let dialog = dialog_for(&window, None)?.set_file_name(default_name);
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_save_file).await? else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    let canonical = window.state::<GrantRegistry>().grant_workspace(&path)?;
    grants::allow_asset_dir(window.app_handle(), &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Open File(s): multi-select picker; each choice is granted as a loose file.
#[tauri::command]
pub async fn pick_files<R: Runtime>(
    window: WebviewWindow<R>,
    filters: Vec<PickFilter>,
) -> Result<Option<Vec<String>>, String> {
    let mut dialog = dialog_for(&window, None)?;
    for filter in &filters {
        let extensions: Vec<&str> = filter.extensions.iter().map(String::as_str).collect();
        dialog = dialog.add_filter(&filter.name, &extensions);
    }
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_pick_files).await? else {
        return Ok(None);
    };
    let grants = window.state::<GrantRegistry>();
    let mut paths = Vec::with_capacity(picked.len());
    for file in picked {
        let path = to_path(file)?;
        let canonical = grants.grant_file(&path)?;
        grants::allow_asset_file(window.app_handle(), &canonical);
        paths.push(path.to_string_lossy().to_string());
    }
    Ok(Some(paths))
}

/// Save dialog, opening in `default_dir` when given.
async fn pick_save_target<R: Runtime>(
    window: &WebviewWindow<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    default_dir: Option<String>,
) -> Result<Option<PathBuf>, String> {
    let exts: Vec<&str> = extensions.iter().map(String::as_str).collect();
    let dialog = dialog_for(window, default_dir)?
        .set_file_name(default_name)
        .add_filter(filter_name, &exts);
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_save_file).await? else {
        return Ok(None);
    };
    to_path(picked).map(Some)
}

/// Export save dialog: pick a destination file and grant it write-only.
#[tauri::command]
pub async fn pick_save<R: Runtime>(
    window: WebviewWindow<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
) -> Result<Option<String>, String> {
    let picked = pick_save_target(&window, default_name, filter_name, extensions, None).await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    window.state::<GrantRegistry>().grant_export_file(&path)?;
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Save As for a new document: the picked file is granted as Open File grants
/// one, so once written it reloads from disk and its relative images load.
#[tauri::command]
pub async fn pick_save_document<R: Runtime>(
    window: WebviewWindow<R>,
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let picked =
        pick_save_target(&window, default_name, filter_name, extensions, default_dir).await?;
    let Some(path) = picked else {
        return Ok(None);
    };
    let canonical = window
        .state::<GrantRegistry>()
        .grant_document_target(&path)?;
    grants::allow_asset_file(window.app_handle(), &canonical);
    Ok(Some(path.to_string_lossy().to_string()))
}

/// Website export: pick an output directory and grant it write-only, unless it
/// is inside `root`, the workspace being exported. Decided here on resolved
/// paths: the renderer can hold the two spelled differently (a symlink, a
/// mapped drive, a short name), so it cannot compare them.
#[tauri::command]
pub async fn pick_export_dir<R: Runtime>(
    window: WebviewWindow<R>,
    root: String,
) -> Result<Option<ExportDirPick>, String> {
    // `root` is the renderer's: checked before any dialog opens.
    let root = window.state::<GrantRegistry>().ensure_workspace(&root)?;
    let dialog = dialog_for(&window, None)?;
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_pick_folder).await? else {
        return Ok(None);
    };
    settle_export_dir(&window.state::<GrantRegistry>(), &to_path(picked)?, &root).map(Some)
}

/// Plugin install: the pick is stashed as the pending plugin dir (not a
/// workspace grant) and consumed by `install_plugin`.
#[tauri::command]
pub async fn pick_plugin_dir<R: Runtime>(
    window: WebviewWindow<R>,
) -> Result<Option<String>, String> {
    let dialog = dialog_for(&window, None)?;
    let Some(picked) = show(dialog, FileDialogBuilder::blocking_pick_folder).await? else {
        return Ok(None);
    };
    let path = to_path(picked)?;
    window
        .state::<GrantRegistry>()
        .set_pending_plugin_dir(path.clone());
    Ok(Some(path.to_string_lossy().to_string()))
}

/// "Move to..." destination picker. No grant is minted; `move_path`
/// independently validates the destination against the workspace root.
#[tauri::command]
pub async fn pick_move_dir<R: Runtime>(
    window: WebviewWindow<R>,
    default_dir: Option<String>,
) -> Result<Option<String>, String> {
    let dialog = dialog_for(&window, default_dir)?;
    match show(dialog, FileDialogBuilder::blocking_pick_folder).await? {
        Some(picked) => Ok(Some(to_path(picked)?.to_string_lossy().to_string())),
        None => Ok(None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use raw_window_handle::HasWindowHandle;
    use tauri::async_runtime::block_on;
    use tauri::test::{mock_app, MockRuntime};
    use tauri::WebviewWindowBuilder;

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
        /// The window whose webview calls the commands.
        window: WebviewWindow<MockRuntime>,
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
        let window = WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
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
            window,
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
            let picked = block_on(pick_export_dir(fx.window.clone(), root.clone()));
            assert_refused(picked, refusal);
        }
    }

    #[test]
    fn the_document_save_picker_refuses_a_starting_folder_that_is_not_a_granted_workspace() {
        let fx = fixture();
        for (dir, refusal) in &fx.refused {
            let picked = block_on(pick_save_document(
                fx.window.clone(),
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
            let picked = block_on(pick_move_dir(fx.window.clone(), Some(dir.clone())));
            assert_refused(picked, refusal);
        }
    }

    /// The plugin keeps the parent private; its `Debug` output is where it
    /// shows. Every mock window has the same handle, so this tells a parent
    /// from none, not one window from another. Only this test adds the plugin:
    /// with it, a check that ran too late in a denial test would open a dialog.
    #[test]
    fn a_dialog_is_parented_to_its_window_on_windows_and_macos_only() {
        let fx = fixture();
        fx.app.handle().plugin(tauri_plugin_dialog::init()).unwrap();
        let handle = format!("{:?}", fx.window.window_handle().unwrap().as_raw());
        let parented = cfg!(any(windows, target_os = "macos"));
        for start_dir in [None, Some(fx.workspace.clone())] {
            let built = format!("{:?}", dialog_for(&fx.window, start_dir).unwrap());
            assert_eq!(built.contains(&handle), parented, "{built}");
        }
    }
}
