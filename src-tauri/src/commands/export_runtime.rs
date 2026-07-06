// Process-terminating half of the CLI export pipeline. `std::process::exit`
// never returns, so this command cannot run inside a unit test; it lives in
// its own file, excluded from codecov, the same way `menu_runtime.rs` holds
// the untestable half of the menu pipeline. The testable pieces (the request
// state and the stdout/stderr routing) live in [`super::export`] with direct
// tests.

use super::export::print_cli_export_outcome;

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
