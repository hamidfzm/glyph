//! Mobile stand-in for crash reporting. The sentry crate is desktop-only in
//! this project (its reqwest/rustls stack is another mobile cross-compile
//! hazard), so error reporting is a silent no-op on android/ios.

use std::sync::Mutex;
use tauri::State;

/// Same shape as the desktop state so `lib.rs` constructs it identically;
/// nothing ever reads the slot on mobile.
pub struct TelemetryState(#[allow(dead_code)] pub Mutex<Option<()>>);

#[tauri::command]
pub fn set_error_reporting(
    _enabled: bool,
    _state: State<'_, TelemetryState>,
) -> Result<(), String> {
    Ok(())
}
