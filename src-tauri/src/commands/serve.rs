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

/// A build failed. The previously exported site stays on disk and keeps being
/// served, so the browser is left showing the last version that worked rather
/// than a half-written one.
#[tauri::command]
pub fn serve_failed(message: String) -> Result<(), String> {
    eprintln!("{message}");
    Ok(())
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
    fn serve_request_serializes_camel_case() {
        let json = serde_json::to_string(&CliServeRequest {
            root: "/ws".to_string(),
            out_dir: "/out".to_string(),
        })
        .unwrap();
        assert!(json.contains("\"outDir\":\"/out\""), "got {json}");
    }

    #[test]
    fn get_cli_serve_is_none_on_an_ordinary_launch() {
        // Nothing manages ServeState unless `glyph serve` set it up, which
        // is what tells the frontend it is not a serve process.
        let app = tauri::test::mock_app();
        assert_eq!(get_cli_serve(app.handle().clone()), None);
    }
}
