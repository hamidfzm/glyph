// Process-terminating half of the CLI export pipeline. `std::process::exit`
// never returns, so this command cannot run inside a unit test; it lives in
// its own file, excluded from codecov, the same way `menu_runtime.rs` holds
// the untestable half of the menu pipeline. The testable pieces (the request
// state and the stdout/stderr routing) live in [`super::export`] with direct
// tests.

use super::export::{cli_export_output, write_cli_export_outcome, CliExport};
use tauri::State;

/// Report the outcome of a CLI export and terminate the process, making the
/// app scriptable: the message always goes to stderr, success also prints the
/// output path to stdout, and a nonzero code fails the CI step. Exits via
/// `std::process::exit` rather than `AppHandle::exit`: the latter unwinds the
/// event loop and the process then reports 0 regardless of the requested code.
/// Refused, with the process left alone, when no CLI export is in progress:
/// the command is registered in every session, and a renderer could otherwise
/// end an interactive one with a message of its choosing on stderr.
#[tauri::command]
pub fn finish_cli_export(
    state: State<'_, CliExport>,
    code: i32,
    message: String,
) -> Result<(), String> {
    // The path printed is the one parsed from argv, never one the renderer names.
    let output = cli_export_output(&state)?;
    let written = write_cli_export_outcome(
        code,
        Some(&output),
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
