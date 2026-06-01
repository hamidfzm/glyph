//! Opt-in, production-only crash reporting via Sentry.
//!
//! The frontend owns the user's opt-in choice (persisted in settings) and drives
//! this module through the [`set_error_reporting`] command. Nothing initializes
//! until the user opts in, and [`init_guard`] is a no-op in debug builds so
//! `pnpm tauri dev` never sends events. PII (absolute file paths, the machine
//! hostname) is stripped in [`scrub_event`] before anything leaves the process.

use std::sync::{Arc, Mutex};

use sentry::protocol::Event;
use tauri::State;

// Single source of truth for the DSN — `src-tauri/sentry.json`, read at build
// time by build.rs and injected as `GLYPH_SENTRY_DSN`. The frontend imports the
// same file, so both clients target the same project. Empty (missing file or
// `dsn`) disables reporting.
const SENTRY_DSN: &str = match option_env!("GLYPH_SENTRY_DSN") {
    Some(dsn) => dsn,
    None => "",
};

/// Holds the live Sentry client guard while reporting is enabled. Dropping the
/// guard (setting this to `None`) flushes and disables the client.
pub struct TelemetryState(pub Mutex<Option<sentry::ClientInitGuard>>);

/// Redact absolute filesystem paths and `file://` URLs from a string so user
/// file locations (which encode usernames and document names) never reach
/// Sentry. Matches Windows drive paths and common POSIX roots.
fn redact_paths(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for token in input.split_inclusive(char::is_whitespace) {
        let (word, trailing_ws) = match token.char_indices().last() {
            Some((i, c)) if c.is_whitespace() => (&token[..i], &token[i..]),
            _ => (token, ""),
        };
        if is_path_like(word) {
            out.push_str("[redacted-path]");
        } else {
            out.push_str(word);
        }
        out.push_str(trailing_ws);
    }
    out
}

/// Heuristic: does this whitespace-delimited token look like an absolute path or
/// a file URL we should redact?
fn is_path_like(word: &str) -> bool {
    if word.starts_with("file://") {
        return true;
    }
    // Windows drive path, e.g. C:\Users\...
    let bytes = word.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\' {
        return true;
    }
    // POSIX absolute path under a user/data-bearing root.
    const ROOTS: [&str; 9] = [
        "/Users/",
        "/home/",
        "/root/",
        "/var/",
        "/tmp/",
        "/private/",
        "/mnt/",
        "/media/",
        "/opt/",
    ];
    ROOTS.iter().any(|root| word.starts_with(root))
}

/// Strip PII from an event before send: null the hostname and redact paths from
/// the message and every exception value.
fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    event.server_name = None;

    if let Some(message) = event.message.take() {
        event.message = Some(redact_paths(&message));
    }

    for exception in &mut event.exception.values {
        if let Some(value) = exception.value.take() {
            exception.value = Some(redact_paths(&value));
        }
    }

    Some(event)
}

/// The privacy-hardened client options: tagged release, no PII, no hostname,
/// and the path-scrubbing `before_send`. Extracted from [`init_guard`] so the
/// configuration can be asserted in tests without initializing a real client.
fn client_options() -> sentry::ClientOptions {
    sentry::ClientOptions {
        release: Some(format!("glyph@{}", env!("CARGO_PKG_VERSION")).into()),
        send_default_pii: false,
        server_name: None,
        before_send: Some(Arc::new(scrub_event)),
        ..Default::default()
    }
}

/// Build a Sentry client guard, or `None` if reporting must stay off. Returns
/// `None` in debug builds (dev) so events are only ever sent from release
/// builds. The default integrations install the panic handler that captures
/// Rust panics.
fn init_guard() -> Option<sentry::ClientInitGuard> {
    if cfg!(debug_assertions) || SENTRY_DSN.is_empty() {
        return None;
    }

    Some(sentry::init((SENTRY_DSN, client_options())))
}

/// Reconcile the desired enabled state with the held guard. Extracted from the
/// command so the enable/disable transitions can be unit-tested without a Tauri
/// `State`.
fn apply_enabled(enabled: bool, guard: &mut Option<sentry::ClientInitGuard>) {
    if enabled {
        if guard.is_none() {
            *guard = init_guard();
        }
    } else {
        *guard = None;
    }
}

/// Lock the guard and reconcile it with `enabled`. Takes `&TelemetryState`
/// (constructible in tests) rather than a Tauri `State` so the lock + apply path
/// is unit-testable; the command is a thin wrapper over this.
fn set_enabled(state: &TelemetryState, enabled: bool) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    apply_enabled(enabled, &mut guard);
    Ok(())
}

/// Frontend-driven toggle. Enabling initializes Sentry (release builds only);
/// disabling drops the guard, which flushes and stops the client.
#[tauri::command]
pub fn set_error_reporting(enabled: bool, state: State<'_, TelemetryState>) -> Result<(), String> {
    set_enabled(&state, enabled)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sentry::protocol::Exception;

    #[test]
    fn redacts_windows_paths() {
        assert_eq!(
            redact_paths(r"open C:\Users\Jane\notes.md failed"),
            "open [redacted-path] failed",
        );
    }

    #[test]
    fn redacts_posix_paths() {
        assert_eq!(
            redact_paths("read /Users/jane/diary.md done"),
            "read [redacted-path] done",
        );
        assert_eq!(redact_paths("at /home/jane/todo.md"), "at [redacted-path]");
    }

    #[test]
    fn redacts_file_urls() {
        assert_eq!(redact_paths("file:///Users/jane/x.md"), "[redacted-path]");
    }

    #[test]
    fn leaves_path_free_text_untouched() {
        let msg = "called `Option::unwrap()` on a `None` value";
        assert_eq!(redact_paths(msg), msg);
    }

    #[test]
    fn scrub_event_nulls_hostname_and_redacts_paths() {
        let event = Event {
            message: Some(r"panic at C:\Users\Jane\a.md".to_string()),
            server_name: Some("janes-machine".into()),
            exception: vec![Exception {
                value: Some("missing /home/jane/b.md".to_string()),
                ..Default::default()
            }]
            .into(),
            ..Default::default()
        };

        let scrubbed = scrub_event(event).expect("event kept");
        assert_eq!(scrubbed.server_name, None);
        assert_eq!(
            scrubbed.message.as_deref(),
            Some("panic at [redacted-path]")
        );
        assert_eq!(
            scrubbed.exception.values[0].value.as_deref(),
            Some("missing [redacted-path]"),
        );
    }

    #[test]
    fn init_guard_is_disabled_in_debug_builds() {
        // The test binary is a debug build, so reporting must stay off.
        assert!(init_guard().is_none());
    }

    #[test]
    fn apply_enabled_transitions_do_not_panic() {
        let mut guard = None;
        // Enable: calls init_guard (None in debug) — guard stays None, no panic.
        apply_enabled(true, &mut guard);
        assert!(guard.is_none());
        // Disable: clears the guard.
        apply_enabled(false, &mut guard);
        assert!(guard.is_none());
    }

    #[test]
    fn client_options_are_privacy_hardened() {
        let opts = client_options();
        assert!(!opts.send_default_pii, "PII must never be sent");
        assert!(opts.server_name.is_none(), "hostname must not be set");
        assert!(opts.before_send.is_some(), "scrubber must be installed");
        assert_eq!(
            opts.release.as_deref(),
            Some(concat!("glyph@", env!("CARGO_PKG_VERSION"))),
        );
    }

    #[test]
    fn set_enabled_toggles_without_a_tauri_state() {
        let state = TelemetryState(Mutex::new(None));
        // Enable then disable both succeed; the guard stays None in debug builds.
        assert!(set_enabled(&state, true).is_ok());
        assert!(state.0.lock().unwrap().is_none());
        assert!(set_enabled(&state, false).is_ok());
        assert!(state.0.lock().unwrap().is_none());
    }
}
