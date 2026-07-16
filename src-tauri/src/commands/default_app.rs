#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::process::Command;

/// Set, or guide the user to set, Glyph as the default application for Markdown
/// files. Silently registering a default handler is restricted on modern
/// desktops, so the behaviour is per-platform and the returned tag tells the UI
/// what happened:
/// - `"registered"`     the association was set for us (Linux, via `xdg-mime`)
/// - `"openedSettings"` the OS Default Apps page was opened so the user can
///                      pick Glyph (Windows blocks silent handler changes)
/// - `"guidance"`       no programmatic path; the UI shows manual steps (macOS)
#[tauri::command]
pub fn set_default_markdown_app() -> Result<String, String> {
    // Exactly one arm survives cfg on any given target, so each is the tail
    // expression of the function (no `return` needed).
    #[cfg(target_os = "linux")]
    {
        // The installed bundle ships a desktop entry named after the bundle id.
        const DESKTOP: &str = "com.hamidfzm.glyph.desktop";
        // Cover the common MIME spellings file managers use for Markdown.
        for mime in ["text/markdown", "text/x-markdown"] {
            let status = Command::new("xdg-mime")
                .args(["default", DESKTOP, mime])
                .status()
                .map_err(|e| format!("xdg-mime is unavailable: {e}"))?;
            if !status.success() {
                return Err(format!("xdg-mime exited with {status}"));
            }
        }
        Ok("registered".into())
    }

    #[cfg(target_os = "windows")]
    {
        // Windows 10+ forbids silently changing the default handler; open the
        // Default Apps settings page so the user can assign Glyph to Markdown.
        Command::new("cmd")
            .args(["/C", "start", "", "ms-settings:defaultapps"])
            .status()
            .map_err(|e| format!("failed to open Default Apps settings: {e}"))?;
        Ok("openedSettings".into())
    }

    #[cfg(target_os = "macos")]
    {
        // Changing the handler needs private LaunchServices calls, so the UI
        // shows Get Info -> Open With guidance instead.
        Ok("guidance".into())
    }

    #[cfg(not(any(target_os = "linux", target_os = "windows", target_os = "macos")))]
    {
        Ok("guidance".into())
    }
}
