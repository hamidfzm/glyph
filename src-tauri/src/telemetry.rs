//! Opt-in, production-only crash reporting via Sentry.
//!
//! The frontend owns the user's opt-in choice (persisted in settings) and drives
//! this module through the [`set_error_reporting`] command. Nothing initializes
//! until the user opts in, and [`init_guard`] is a no-op in debug builds so
//! `pnpm tauri dev` never sends events. PII (absolute file paths, the machine
//! hostname) is stripped in [`scrub_event`] before anything leaves the process.

use std::sync::{Arc, LazyLock, Mutex};

use regex::{Captures, Regex};
use sentry::protocol::{Event, Stacktrace};
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

const REDACTED: &str = "[redacted-path]";

// Paths contain spaces and apostrophes, so a match runs to the next `:`,
// quote, angle bracket, or pipe rather than to whitespace (legal in POSIX
// names but rare, and `:` keeps "path: reason" messages readable): a trailing
// word is over-redacted rather than a document name leaked. Windows verbatim
// prefixes (`\\?\`, `\\?\UNC\`), which every canonicalized path carries, are
// stripped first so the drive and UNC patterns see the plain form. Mirrors
// src/lib/telemetry.ts.
static VERBATIM_PREFIX: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\\\\\?\\(UNC\\)?").expect("valid regex"));
static FILE_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"file://[^"<>|\n]+"#).expect("valid regex"));
static WINDOWS_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\b[A-Za-z]:[\\/][^"<>|:?*\n]+"#).expect("valid regex"));
static UNC_PATH: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r#"\\\\[^"<>|:?*\\\s]+\\[^"<>|:?*\n]+"#).expect("valid regex"));
static POSIX_PATH: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r#"/(?:Users|home|root|var|tmp|private|mnt|media|opt|Volumes|srv|run|storage|sdcard|data)/[^"<>|:\n]+"#,
    )
    .expect("valid regex")
});

/// Anchors after which a source path stops being the build machine's layout
/// and starts naming the file inside this repo or a registry crate.
const FRAME_PATH_ANCHORS: [&str; 5] = [
    "src-tauri/",
    "src-tauri\\",
    ".cargo/registry/src/",
    ".cargo\\registry\\src\\",
    "/rustc/",
];

/// Redact absolute filesystem paths and `file://` URLs from a string so user
/// file locations (which encode usernames and document names) never reach
/// Sentry.
fn redact_paths(input: &str) -> String {
    let plain = VERBATIM_PREFIX.replace_all(input, |caps: &Captures| {
        if caps.get(1).is_some() {
            r"\\".to_string()
        } else {
            String::new()
        }
    });
    let out = FILE_URL.replace_all(&plain, REDACTED);
    let out = WINDOWS_PATH.replace_all(&out, REDACTED);
    let out = UNC_PATH.replace_all(&out, REDACTED);
    POSIX_PATH.replace_all(&out, REDACTED).into_owned()
}

/// Keep the tail of a frame's source path from the first known anchor so the
/// frame still names its file; the prefix is the build machine's (or, for a
/// local build, the user's) directory layout. Anything else is redacted like
/// any other path; relative file names pass through untouched.
fn redact_frame_path(path: &str) -> String {
    FRAME_PATH_ANCHORS
        .iter()
        .filter_map(|anchor| path.find(anchor))
        .min()
        .map(|idx| path[idx..].to_string())
        .unwrap_or_else(|| redact_paths(path))
}

fn redact_frames(stack: &mut Stacktrace) {
    for frame in &mut stack.frames {
        if let Some(path) = frame.abs_path.take() {
            frame.abs_path = Some(redact_frame_path(&path));
        }
        if let Some(file) = frame.filename.take() {
            frame.filename = Some(redact_frame_path(&file));
        }
    }
}

/// Strip PII from an event before send: null the hostname and redact paths from
/// the message, log entry, exception values, stack frames, and breadcrumbs.
fn scrub_event(mut event: Event<'static>) -> Option<Event<'static>> {
    event.server_name = None;

    if let Some(message) = event.message.take() {
        event.message = Some(redact_paths(&message));
    }
    if let Some(entry) = &mut event.logentry {
        entry.message = redact_paths(&entry.message);
    }

    for exception in &mut event.exception.values {
        if let Some(value) = exception.value.take() {
            exception.value = Some(redact_paths(&value));
        }
        if let Some(stack) = &mut exception.stacktrace {
            redact_frames(stack);
        }
        if let Some(stack) = &mut exception.raw_stacktrace {
            redact_frames(stack);
        }
    }
    for thread in &mut event.threads.values {
        if let Some(stack) = &mut thread.stacktrace {
            redact_frames(stack);
        }
        if let Some(stack) = &mut thread.raw_stacktrace {
            redact_frames(stack);
        }
    }
    for crumb in &mut event.breadcrumbs.values {
        if let Some(message) = crumb.message.take() {
            crumb.message = Some(redact_paths(&message));
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

/// Send everything still queued. Needed on the Windows exit path, which calls
/// `process::exit` and so never drops the guard that would flush on its own.
/// No-op when reporting is off (no client installed).
#[cfg(target_os = "windows")]
pub fn flush() {
    if let Some(client) = sentry::Hub::current().client() {
        client.flush(Some(std::time::Duration::from_secs(2)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use sentry::protocol::{Breadcrumb, Exception, Frame, LogEntry, Thread};

    #[test]
    fn redacts_windows_paths_up_to_the_next_delimiter() {
        assert_eq!(
            redact_paths(r"open C:\Users\Jane\notes.md failed"),
            "open [redacted-path]",
        );
        assert_eq!(
            redact_paths(r#"open "C:\Users\Jane\notes.md" failed"#),
            r#"open "[redacted-path]" failed"#,
        );
        assert_eq!(
            redact_paths("open D:/Notes/secret.md failed"),
            "open [redacted-path]"
        );
    }

    #[test]
    fn keeps_a_path_containing_spaces_or_apostrophes_whole() {
        assert_eq!(
            redact_paths(r"open C:\Users\Jane Doe\My Notes.md: denied"),
            "open [redacted-path]: denied",
        );
        assert_eq!(
            redact_paths(r"open C:\Users\Jane's Notes\diary.md: denied"),
            "open [redacted-path]: denied",
        );
        assert_eq!(
            redact_paths("read /Users/Jane Doe/Q's notes.md: denied"),
            "read [redacted-path]: denied",
        );
    }

    #[test]
    fn frame_paths_keep_their_in_repo_or_registry_tail() {
        assert_eq!(
            redact_frame_path(r"C:\Users\Jane\code\glyph\src-tauri\src\main.rs"),
            r"src-tauri\src\main.rs"
        );
        assert_eq!(
            redact_frame_path(
                "/home/ci/.cargo/registry/src/index.crates.io-abc/tauri-2.0.0/src/lib.rs"
            ),
            ".cargo/registry/src/index.crates.io-abc/tauri-2.0.0/src/lib.rs"
        );
        assert_eq!(
            redact_frame_path("/Users/jane/other/main.rs"),
            "[redacted-path]"
        );
        assert_eq!(redact_frame_path("src/main.rs"), "src/main.rs");
    }

    #[test]
    fn redacts_verbatim_and_unc_windows_paths() {
        assert_eq!(
            redact_paths(r"at \\?\C:\Users\Jane\a.md"),
            "at [redacted-path]"
        );
        assert_eq!(
            redact_paths(r"at \\?\UNC\nas\share\Jane\a.md"),
            "at [redacted-path]"
        );
        assert_eq!(
            redact_paths(r"at \\nas\share\Jane Doe\a.md"),
            "at [redacted-path]"
        );
    }

    #[test]
    fn redacts_posix_paths() {
        assert_eq!(
            redact_paths("read /Users/jane/diary.md done"),
            "read [redacted-path]"
        );
        assert_eq!(redact_paths("at /home/jane/todo.md"), "at [redacted-path]");
        assert_eq!(
            redact_paths("at /Volumes/Work/notes.md"),
            "at [redacted-path]"
        );
        assert_eq!(
            redact_paths("at /storage/emulated/0/Documents/notes.md"),
            "at [redacted-path]"
        );
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
    fn scrub_event_nulls_hostname_and_redacts_paths_everywhere() {
        let frame = |path: &str| Frame {
            abs_path: Some(path.to_string()),
            filename: Some("src/main.rs".to_string()),
            ..Default::default()
        };
        let stack = |path: &str| Stacktrace {
            frames: vec![frame(path)],
            ..Default::default()
        };
        let event = Event {
            message: Some(r"panic at C:\Users\Jane\a.md".to_string()),
            logentry: Some(LogEntry {
                message: "opened /home/jane/c.md".to_string(),
                ..Default::default()
            }),
            server_name: Some("janes-machine".into()),
            exception: vec![Exception {
                value: Some("missing /home/jane/b.md".to_string()),
                stacktrace: Some(stack(r"C:\Users\Jane\code\glyph\src-tauri\src\main.rs")),
                raw_stacktrace: Some(stack(r"C:\Users\Jane\other\raw.rs")),
                ..Default::default()
            }]
            .into(),
            threads: vec![Thread {
                stacktrace: Some(stack("/Users/jane/src/main.rs")),
                raw_stacktrace: Some(stack("/Users/jane/raw.rs")),
                ..Default::default()
            }]
            .into(),
            breadcrumbs: vec![Breadcrumb {
                message: Some("watching /home/jane/notes".to_string()),
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
            scrubbed.logentry.as_ref().map(|e| e.message.as_str()),
            Some("opened [redacted-path]")
        );
        let exception = &scrubbed.exception.values[0];
        assert_eq!(exception.value.as_deref(), Some("missing [redacted-path]"));
        let frame = &exception.stacktrace.as_ref().unwrap().frames[0];
        assert_eq!(frame.abs_path.as_deref(), Some(r"src-tauri\src\main.rs"));
        assert_eq!(frame.filename.as_deref(), Some("src/main.rs"));
        let thread_frame = &scrubbed.threads.values[0]
            .stacktrace
            .as_ref()
            .unwrap()
            .frames[0];
        assert_eq!(thread_frame.abs_path.as_deref(), Some("[redacted-path]"));
        let raw_path =
            |stack: &Option<Stacktrace>| stack.as_ref().unwrap().frames[0].abs_path.clone();
        assert_eq!(
            raw_path(&exception.raw_stacktrace).as_deref(),
            Some("[redacted-path]")
        );
        assert_eq!(
            raw_path(&scrubbed.threads.values[0].raw_stacktrace).as_deref(),
            Some("[redacted-path]")
        );
        assert_eq!(
            scrubbed.breadcrumbs.values[0].message.as_deref(),
            Some("watching [redacted-path]")
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

    #[cfg(target_os = "windows")]
    #[test]
    fn flush_is_a_no_op_without_a_client() {
        // The Windows exit path calls this before `process::exit`, including
        // when the user never opted in.
        flush();
    }

    #[test]
    fn set_error_reporting_command_runs_through_managed_state() {
        use tauri::Manager;
        // Drive the #[tauri::command] wrapper end to end against a managed
        // TelemetryState, mirroring how lib.rs tests use a mock app.
        let app = tauri::test::mock_app();
        app.manage(TelemetryState(Mutex::new(None)));
        assert!(set_error_reporting(true, app.state()).is_ok());
        assert!(set_error_reporting(false, app.state()).is_ok());
    }
}
