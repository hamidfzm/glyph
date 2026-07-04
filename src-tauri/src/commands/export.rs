use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

/// A headless website export requested on the command line
/// (`glyph <folder> --export-website <outDir>`), stashed at startup for the
/// frontend to pick up once it mounts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliExportRequest {
    pub root: String,
    pub out_dir: String,
}

pub struct CliExport(pub Mutex<Option<CliExportRequest>>);

/// The CLI export request for this launch, if any. Unlike the initial
/// file/folder stash this is *not* consumed: the window-reveal gate and the
/// export runner both read it.
#[tauri::command]
pub fn get_cli_export(state: State<'_, CliExport>) -> Option<CliExportRequest> {
    state.0.lock().ok()?.clone()
}

/// Route the outcome message: stdout for success, stderr for failure (so CI
/// logs read naturally and `2>/dev/null` keeps only the summary). Split from
/// the command so the branch is unit-testable; the command never returns.
fn print_cli_export_outcome(code: i32, message: &str) {
    if code == 0 {
        println!("{message}");
    } else {
        eprintln!("{message}");
    }
}

/// Report the outcome of a CLI export and terminate the process, making the
/// app scriptable: success prints to stdout and exits 0, failure prints to
/// stderr and exits nonzero (CI fails the step). Exits via
/// `std::process::exit` rather than `AppHandle::exit`: the latter unwinds the
/// event loop and the process then reports 0 regardless of the requested code.
#[tauri::command]
pub fn finish_cli_export(code: i32, message: String) {
    print_cli_export_outcome(code, &message);
    std::process::exit(code);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_cli_export_returns_the_stashed_request_without_consuming_it() {
        use tauri::test::mock_app;
        use tauri::Manager;

        let app = mock_app();
        app.manage(CliExport(Mutex::new(Some(CliExportRequest {
            root: "/ws".to_string(),
            out_dir: "/out".to_string(),
        }))));
        // Not consume-on-read: the reveal gate and the export runner both ask.
        let first = get_cli_export(app.state::<CliExport>());
        let second = get_cli_export(app.state::<CliExport>());
        assert_eq!(first, second);
        assert_eq!(first.unwrap().root, "/ws");
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
            root: "/ws".to_string(),
            out_dir: "/out".to_string(),
        };
        let json = serde_json::to_string(&request).unwrap();
        assert!(json.contains("\"outDir\":\"/out\""), "got {json}");
        assert!(json.contains("\"root\":\"/ws\""), "got {json}");
    }

    #[test]
    fn cli_export_default_is_none() {
        let state = CliExport(Mutex::new(None));
        assert!(state.0.lock().unwrap().is_none());
    }

    #[test]
    fn print_cli_export_outcome_takes_both_streams() {
        // Routing is by code: 0 -> stdout, nonzero -> stderr. The output
        // itself is not captured here; this exercises both branches so a
        // future panic or format regression is caught.
        print_cli_export_outcome(0, "exported fine");
        print_cli_export_outcome(1, "export failed");
    }
}
