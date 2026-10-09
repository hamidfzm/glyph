use serde::Serialize;
use std::io::{self, Write};
use std::sync::Mutex;
use tauri::State;

/// A headless export requested on the command line
/// (`glyph export <path> --format <format> [--out <path>]`), stashed at startup for
/// the frontend to pick up once it mounts. `input` is a workspace folder for
/// the `site` format and a document for every other one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExportRequest {
    pub input: String,
    pub format: String,
    pub output: String,
}

pub struct CliExport(pub Mutex<Option<CliExportRequest>>);

/// The CLI export request for this launch, if any. Unlike the initial
/// file/folder stash this is *not* consumed: the window-reveal gate and the
/// export runner both read it.
#[tauri::command]
pub fn get_cli_export(state: State<'_, CliExport>) -> Option<CliExportRequest> {
    state.0.lock().ok()?.clone()
}

/// Split from `finish_cli_export` (in [`super::export_runtime`]) so the stream
/// routing is unit-testable; the command itself never returns.
pub(crate) fn write_cli_export_outcome(
    code: i32,
    output: Option<&str>,
    message: &str,
    stdout: &mut impl Write,
    stderr: &mut impl Write,
) -> io::Result<()> {
    // Nobody is left to tell about a failed stderr write; a lost path is an error.
    let _ = writeln!(stderr, "{message}");
    if code != 0 {
        return Ok(());
    }
    if let Some(output) = output {
        writeln!(stdout, "{output}")?;
    }
    Ok(())
}

/// What picking a website export folder came to: granted write-only, or
/// refused with no grant because it is inside the workspace being exported.
#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ExportDirPick {
    Granted { path: String },
    InsideWorkspace,
}

/// Split from `pick_export_dir` (in [`super::pick`]) so what follows the
/// dialog is unit-testable. `picked` goes back as the dialog spelled it: the
/// export joins page paths onto it with `/`, which a verbatim path does not
/// take as a separator.
#[cfg(desktop)]
pub(crate) fn settle_export_dir(
    grants: &crate::grants::GrantRegistry,
    picked: &std::path::Path,
    workspace: &std::path::Path,
) -> Result<ExportDirPick, String> {
    if !grants.grant_export_dir_outside(picked, workspace)? {
        return Ok(ExportDirPick::InsideWorkspace);
    }
    Ok(ExportDirPick::Granted {
        path: picked.to_string_lossy().to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picked_export_dir_is_refused_inside_the_workspace_and_granted_outside_it() {
        let tmp = tempfile::TempDir::new().unwrap();
        let root = tmp.path().join("ws");
        let out = tmp.path().join("out");
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::create_dir_all(&out).unwrap();
        let grants = crate::grants::GrantRegistry::default();
        let workspace = grants.grant_workspace(&root).unwrap();

        assert_eq!(
            settle_export_dir(&grants, &root.join("sub"), &workspace),
            Ok(ExportDirPick::InsideWorkspace)
        );
        // Not the canonical spelling, which on Windows carries a verbatim prefix.
        assert_eq!(
            settle_export_dir(&grants, &out, &workspace),
            Ok(ExportDirPick::Granted {
                path: out.to_string_lossy().to_string()
            })
        );
        let page = out.join("index.html").to_string_lossy().to_string();
        assert!(grants.ensure_writable(&page).is_ok());
    }

    #[test]
    fn an_export_dir_pick_reaches_the_frontend_tagged_by_kind() {
        let granted = ExportDirPick::Granted {
            path: "/out".to_string(),
        };
        assert_eq!(
            serde_json::to_value(granted).unwrap(),
            serde_json::json!({ "kind": "granted", "path": "/out" })
        );
        assert_eq!(
            serde_json::to_value(ExportDirPick::InsideWorkspace).unwrap(),
            serde_json::json!({ "kind": "insideWorkspace" })
        );
    }

    #[test]
    fn get_cli_export_returns_the_stashed_request_without_consuming_it() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(CliExport(Mutex::new(Some(CliExportRequest {
            input: "/ws/notes.md".to_string(),
            format: "pdf".to_string(),
            output: "/ws/notes.pdf".to_string(),
        }))));
        // Not consume-on-read: the reveal gate and the export runner both ask.
        let first = get_cli_export(app.state::<CliExport>());
        let second = get_cli_export(app.state::<CliExport>());
        assert_eq!(first, second);
        assert_eq!(first.unwrap().input, "/ws/notes.md");
    }

    #[test]
    fn get_cli_export_returns_none_when_unset() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(CliExport(Mutex::new(None)));
        assert!(get_cli_export(app.state::<CliExport>()).is_none());
    }

    #[test]
    fn cli_export_request_serializes_camel_case() {
        let request = CliExportRequest {
            input: "/ws".to_string(),
            format: "site".to_string(),
            output: "/out".to_string(),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"input\":\"/ws\""), "got {json}");
        assert!(json.contains("\"format\":\"site\""), "got {json}");
        assert!(json.contains("\"output\":\"/out\""), "got {json}");
    }

    #[test]
    fn cli_export_default_is_none() {
        let state = CliExport(Mutex::new(None));
        assert!(state.0.lock().unwrap().is_none());
    }

    fn outcome(code: i32, output: Option<&str>, message: &str) -> (String, String) {
        let (mut stdout, mut stderr) = (Vec::new(), Vec::new());
        write_cli_export_outcome(code, output, message, &mut stdout, &mut stderr).unwrap();
        (
            String::from_utf8(stdout).unwrap(),
            String::from_utf8(stderr).unwrap(),
        )
    }

    #[test]
    fn a_successful_export_prints_only_its_path_to_stdout() {
        // `out=$(glyph export ...)` must capture a path, not the summary.
        let (stdout, stderr) = outcome(0, Some("/ws/notes.pdf"), "Exported /ws/notes.pdf");
        assert_eq!(stdout, "/ws/notes.pdf\n");
        assert_eq!(stderr, "Exported /ws/notes.pdf\n");
    }

    #[test]
    fn a_warning_stays_on_stderr_with_the_summary() {
        // A site whose cleanup failed still exits 0, so a script must still
        // capture a path and nothing else.
        let message = "Exported 3 pages to /out\nWarning: cleanup after the export failed";
        let (stdout, stderr) = outcome(0, Some("/out"), message);
        assert_eq!(stdout, "/out\n");
        assert_eq!(stderr, format!("{message}\n"));
    }

    #[test]
    fn a_failed_export_prints_nothing_to_stdout() {
        let (stdout, stderr) = outcome(1, Some("/ws/notes.pdf"), "Export failed: boom");
        assert_eq!(stdout, "");
        assert_eq!(stderr, "Export failed: boom\n");
    }

    #[test]
    fn a_path_that_cannot_reach_stdout_is_an_error() {
        // An empty slice refuses every byte, like `> file` on a full disk.
        let mut full: &mut [u8] = &mut [];
        let result = write_cli_export_outcome(
            0,
            Some("/ws/notes.pdf"),
            "Exported /ws/notes.pdf",
            &mut full,
            &mut Vec::new(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn a_launch_without_an_export_request_prints_no_path() {
        let (stdout, _) = outcome(0, None, "Exported 3 pages and 1 assets to /out");
        assert_eq!(stdout, "");
    }
}
