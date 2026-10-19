//! Keeps every webview on the app's own pages. The link component prompts
//! before a document's link opens in the browser, but markup that reaches the
//! page by another route (a diagram's SVG anchor, a plugin's output) can put
//! a plain `<a>` in it, and wry allows any top-level navigation by default:
//! the window would then show the remote page in place of the app, where the
//! init script's `window.__GLYPH_OPEN__` is readable.

use tauri::plugin::{Builder, TauriPlugin};
use tauri::{Manager, Runtime, Url};

/// Registered on the app builder, so it covers the main window and every
/// window `windows_runtime::spawn_window` builds.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            // Only a dev build loads the page from `build.devUrl`.
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.as_ref()
            } else {
                None
            };
            is_app_url(url, dev_url)
        })
        .build()
}

/// Whether `url` is one of the app's own pages: `tauri://localhost` (macOS,
/// Linux, iOS), `tauri.localhost` (Windows, Android; `https` with
/// `useHttpsScheme`), or the origin of the dev server when one is in use.
fn is_app_url(url: &Url, dev_url: Option<&Url>) -> bool {
    match (url.scheme(), url.host_str(), url.port()) {
        ("tauri", Some("localhost"), None) => true,
        ("http" | "https", Some("tauri.localhost"), None) => true,
        _ => dev_url.is_some_and(|dev| dev.origin() == url.origin()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DEV_URL: &str = "http://localhost:1420";

    fn allowed(url: &str, dev_url: Option<&str>) -> bool {
        let dev_url = dev_url.map(|dev| Url::parse(dev).unwrap());
        is_app_url(&Url::parse(url).unwrap(), dev_url.as_ref())
    }

    #[test]
    fn the_app_origins_pass_in_every_build() {
        for url in [
            "tauri://localhost/index.html",
            "tauri://localhost/index.html#heading",
            "http://tauri.localhost/",
            "https://tauri.localhost/index.html",
        ] {
            assert!(allowed(url, None), "{url} in release");
            assert!(allowed(url, Some(DEV_URL)), "{url} in dev");
        }
    }

    #[test]
    fn the_dev_server_passes_only_in_a_dev_build() {
        assert!(allowed("http://localhost:1420/", Some(DEV_URL)));
        assert!(!allowed("http://localhost:1420/", None));
        // The origin the config names, not every localhost: a mobile dev
        // build names the host's LAN address instead.
        assert!(!allowed("http://localhost:1421/", Some(DEV_URL)));
        assert!(!allowed("http://127.0.0.1:1420/", Some(DEV_URL)));
        assert!(allowed(
            "http://192.168.1.5:1420/",
            Some("http://192.168.1.5:1420")
        ));
    }

    #[test]
    fn a_remote_page_fails() {
        for url in [
            "https://attacker.example/",
            "http://attacker.example/tauri.localhost",
            "https://tauri.localhost.attacker.example/",
            "http://tauri.localhost@attacker.example/",
            "http://tauri.localhost:8080/",
            "tauri://attacker.example/",
        ] {
            assert!(!allowed(url, None), "{url} in release");
            assert!(!allowed(url, Some(DEV_URL)), "{url} in dev");
        }
    }

    #[test]
    fn other_schemes_fail() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<p>x</p>",
            "about:blank",
            "asset://localhost/tmp/note.png",
        ] {
            assert!(!allowed(url, Some(DEV_URL)), "{url}");
        }
    }
}
