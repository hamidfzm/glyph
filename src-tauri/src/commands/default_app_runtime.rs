// Process-spawning half of "set Glyph as the default Markdown app". Its arms
// shell out to a real process (`xdg-mime` on Linux, `start ms-settings:` on
// Windows) or return static guidance, and running the Linux one rewrites the
// host's default-app registration, so this command cannot run inside a unit
// test; it lives in its own file, excluded from codecov, the same way
// `export_runtime.rs` holds the untestable half of the CLI export. What the
// Linux arm decides on lives in [`super::default_app`] with direct tests.

#[cfg(target_os = "linux")]
use super::default_app::{
    applications_dirs, desktop_entry_installed, linux_plan, LinuxPlan, DESKTOP_ENTRY,
};
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
/// - `"sandboxed"`      a Flatpak or snap cannot reach the host's defaults; the
///                      UI shows file-manager steps (Linux)
/// - `"noDesktopEntry"` no desktop entry is installed to register, as with an
///                      AppImage (Linux)
#[tauri::command]
pub fn set_default_markdown_app() -> Result<String, String> {
    // Exactly one arm survives cfg on any given target, so each is the tail
    // expression of the function (no `return` needed).
    #[cfg(target_os = "linux")]
    {
        let entry_installed = desktop_entry_installed(&applications_dirs(
            dirs::data_dir(),
            std::env::var_os("XDG_DATA_DIRS"),
            std::env::var_os("APPDIR"),
        ));
        let plan = linux_plan(
            std::env::var("FLATPAK_ID").ok().as_deref(),
            std::env::var("SNAP_NAME").ok().as_deref(),
            entry_installed,
        );
        match plan {
            LinuxPlan::Sandboxed => Ok("sandboxed".into()),
            LinuxPlan::NoDesktopEntry => Ok("noDesktopEntry".into()),
            LinuxPlan::Register => {
                // Cover the common MIME spellings file managers use for Markdown.
                for mime in ["text/markdown", "text/x-markdown"] {
                    let status = Command::new("xdg-mime")
                        .args(["default", DESKTOP_ENTRY, mime])
                        .status()
                        .map_err(|e| format!("xdg-mime is unavailable: {e}"))?;
                    if !status.success() {
                        return Err(format!("xdg-mime exited with {status}"));
                    }
                }
                Ok("registered".into())
            }
        }
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
