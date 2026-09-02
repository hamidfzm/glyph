//! State and commands for `glyph serve`.
//!
//! The renderer owns the export (it is the only place the site pipeline
//! runs), so the two sides talk over these commands: the frontend reports
//! that a build finished, and Rust decides what that means for the people
//! watching the site in a browser.

use serde::Serialize;
use std::sync::Mutex;
use tauri::Manager;
use tokio::sync::broadcast;

/// What the frontend needs in order to render the site being served.
/// Mirrors [`super::export::CliExportRequest`], but says nothing about
/// exiting: a serve process renders many times over its life.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliServeRequest {
    pub root: String,
    pub out_dir: String,
}

/// Everything the serve loop needs once the server is bound.
pub struct ServeState {
    pub request: CliServeRequest,
    /// The URL to print, already resolved: `--port 0` means the port is only
    /// known after binding.
    pub url: String,
    /// The folder as it should be printed. `request.root` is canonical, which
    /// on Windows carries the extended-length prefix: correct to open with,
    /// noise to read.
    pub display_root: String,
    /// Broadcast to every open event stream after a successful rebuild.
    pub reload: broadcast::Sender<()>,
    /// Whether the ready line has been printed. The first export is startup,
    /// every one after it is a rebuild, and only the first announces itself.
    announced: Mutex<bool>,
}

impl ServeState {
    pub fn new(
        request: CliServeRequest,
        display_root: String,
        url: String,
        reload: broadcast::Sender<()>,
    ) -> Self {
        Self {
            request,
            display_root,
            url,
            reload,
            announced: Mutex::new(false),
        }
    }

    /// Record that a build finished and report whether this was the first
    /// one. Split from the command so the first-time behaviour is testable
    /// without a running app.
    pub fn take_first_build(&self) -> bool {
        let Ok(mut announced) = self.announced.lock() else {
            return false;
        };
        let first = !*announced;
        *announced = true;
        first
    }
}

/// What this process should serve, or `None` on any other kind of launch.
/// Reached through `try_state` rather than an injected `State`, because on
/// every other launch the state is simply not there.
#[tauri::command]
pub fn get_cli_serve<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Option<CliServeRequest> {
    Some(app.try_state::<ServeState>()?.request.clone())
}

/// A build finished. The first one announces the URL, since the site only
/// becomes worth visiting once there is something in it; every later one
/// tells the open browsers to reload.
#[tauri::command]
pub fn serve_ready<R: tauri::Runtime>(app: tauri::AppHandle<R>) -> Result<(), String> {
    let state = app
        .try_state::<ServeState>()
        .ok_or_else(|| "not serving".to_string())?;
    if state.take_first_build() {
        println!("Serving {} at {}", state.display_root, state.url);
    }
    // An error here only means nobody has the page open, which is normal.
    let _ = state.reload.send(());
    Ok(())
}

/// A build failed. Whatever was exported last stays on disk and keeps being
/// served, so a browser is left showing a site rather than nothing. It is not
/// necessarily the previous site in full: the export writes pages in place,
/// so a failure part way through leaves new and old pages mixed (see #707).
#[tauri::command]
pub fn serve_failed<R: tauri::Runtime>(
    app: tauri::AppHandle<R>,
    message: String,
) -> Result<(), String> {
    // Guarded like `serve_ready`: without it any launch could print whatever
    // it liked to this process's stderr.
    app.try_state::<ServeState>()
        .ok_or_else(|| "not serving".to_string())?;
    eprintln!("{message}");
    Ok(())
}

/// Keeps the folder watch alive for the life of the process. A named type
/// because Tauri's state map is keyed by type: a bare `Mutex<..>` would be
/// undiscoverable, and would collide with any other bare one added later.
pub struct ServeWatcher {
    /// Never read. `notify` stops watching the moment the watcher is dropped,
    /// so owning it here is the whole point of the type.
    pub _watcher: Mutex<notify::RecommendedWatcher>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> ServeState {
        let (reload, _) = broadcast::channel(4);
        ServeState::new(
            CliServeRequest {
                root: "/ws".to_string(),
                out_dir: "/out".to_string(),
            },
            "/ws".to_string(),
            "http://127.0.0.1:4173".to_string(),
            reload,
        )
    }

    #[test]
    fn only_the_first_build_is_the_first_build() {
        let state = state();
        assert!(state.take_first_build(), "startup build should announce");
        assert!(!state.take_first_build(), "a rebuild must not re-announce");
        assert!(!state.take_first_build());
    }

    #[test]
    fn a_poisoned_latch_does_not_re_announce() {
        // A panic while the latch was held must not turn every later rebuild
        // back into a startup that reprints the URL.
        let state = std::sync::Arc::new(state());
        let poisoner = std::sync::Arc::clone(&state);
        let _ = std::thread::spawn(move || {
            let _held = poisoner.announced.lock().unwrap();
            panic!("while holding the latch");
        })
        .join();

        assert!(
            state.announced.is_poisoned(),
            "the latch should be poisoned"
        );
        assert!(
            !state.take_first_build(),
            "a poisoned latch announces nothing"
        );
    }

    #[test]
    fn serve_request_serializes_camel_case() {
        let json = serde_json::to_string(&CliServeRequest {
            root: "/ws".to_string(),
            out_dir: "/out".to_string(),
        })
        .unwrap();
        assert!(json.contains("\"outDir\":\"/out\""), "got {json}");
    }

    #[test]
    fn a_finished_build_reaches_the_open_browsers() {
        let app = tauri::test::mock_app();
        let (reload, mut browser) = {
            let (sender, _) = broadcast::channel(4);
            let receiver = sender.subscribe();
            (sender, receiver)
        };
        app.manage(ServeState::new(
            CliServeRequest {
                root: "/ws".to_string(),
                out_dir: "/out".to_string(),
            },
            "/ws".to_string(),
            "http://127.0.0.1:4173".to_string(),
            reload,
        ));

        assert_eq!(serve_ready(app.handle().clone()), Ok(()));
        assert_eq!(
            browser.try_recv(),
            Ok(()),
            "a page open on the site reloads"
        );

        // The second build is a rebuild: it reloads without announcing again.
        assert_eq!(serve_ready(app.handle().clone()), Ok(()));
        assert_eq!(browser.try_recv(), Ok(()));
    }

    #[test]
    fn a_failed_build_reports_without_reloading() {
        let app = tauri::test::mock_app();
        let (reload, mut browser) = {
            let (sender, _) = broadcast::channel(4);
            let receiver = sender.subscribe();
            (sender, receiver)
        };
        app.manage(ServeState::new(
            CliServeRequest {
                root: "/ws".to_string(),
                out_dir: "/out".to_string(),
            },
            "/ws".to_string(),
            "http://127.0.0.1:4173".to_string(),
            reload,
        ));

        assert_eq!(
            serve_failed(app.handle().clone(), "Rebuild failed: boom".to_string()),
            Ok(())
        );
        // Nothing reloads: the browser keeps the version it already has.
        assert_eq!(
            browser.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );
    }

    #[test]
    fn the_serve_commands_refuse_a_launch_that_is_not_serving() {
        // Any renderer can invoke a command; without the guard these would
        // announce a URL and print to stderr on an ordinary launch.
        let app = tauri::test::mock_app();
        assert_eq!(
            serve_ready(app.handle().clone()),
            Err("not serving".to_string())
        );
        assert_eq!(
            serve_failed(app.handle().clone(), "anything".to_string()),
            Err("not serving".to_string())
        );
    }

    #[test]
    fn get_cli_serve_is_none_on_an_ordinary_launch() {
        // Nothing manages ServeState unless `glyph serve` set it up, which
        // is what tells the frontend it is not a serve process.
        let app = tauri::test::mock_app();
        assert_eq!(get_cli_serve(app.handle().clone()), None);
    }
}
