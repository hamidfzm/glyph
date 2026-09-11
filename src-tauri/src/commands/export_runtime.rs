// Process-terminating half of the CLI export pipeline. `std::process::exit`
// never returns, so this command cannot run inside a unit test; it lives in
// its own file, excluded from codecov, the same way `menu_runtime.rs` holds
// the untestable half of the menu pipeline. The testable pieces (the request
// state and the stdout/stderr routing) live in [`super::export`] with direct
// tests.

use super::export::{get_cli_export, write_cli_export_outcome, CliExport};
use tauri::State;

/// Report the outcome of a CLI export and terminate the process, making the
/// app scriptable: the message always goes to stderr, success also prints the
/// output path to stdout, and a nonzero code fails the CI step. Exits via
/// `std::process::exit` rather than `AppHandle::exit`: the latter unwinds the
/// event loop and the process then reports 0 regardless of the requested code.
#[tauri::command]
pub fn finish_cli_export(state: State<'_, CliExport>, code: i32, message: String) {
    // The path printed is the one parsed from argv, never one the renderer names.
    let output = get_cli_export(state).map(|request| request.output);
    let written = write_cli_export_outcome(
        code,
        output.as_deref(),
        &message,
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    );
    if let Err(err) = written {
        eprintln!("Export failed: could not write the output path: {err}");
        std::process::exit(1);
    }
    std::process::exit(code);
}
