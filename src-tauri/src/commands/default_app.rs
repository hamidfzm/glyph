#[cfg(any(target_os = "linux", test))]
use std::ffi::OsString;
#[cfg(any(target_os = "linux", test))]
use std::path::PathBuf;
#[cfg(any(target_os = "linux", target_os = "windows"))]
use std::process::Command;

/// The desktop entry of the .deb, the .rpm and every package built from one.
/// The Tauri bundler names it after the product name, not the bundle identifier.
#[cfg(any(target_os = "linux", test))]
const DESKTOP_ENTRY: &str = concat!(env!("GLYPH_PRODUCT_NAME"), ".desktop");

/// The Flatpak app id (`flatpak/com.hamidfzm.glyph.yml`) is the bundle identifier.
#[cfg(any(target_os = "linux", test))]
const FLATPAK_ID: &str = crate::data_dir::IDENTIFIER;

/// `name:` in `snap/snapcraft.yaml`.
#[cfg(any(target_os = "linux", test))]
const SNAP_NAME: &str = "glyph";

#[cfg(any(target_os = "linux", test))]
#[derive(Debug, PartialEq)]
enum LinuxPlan {
    Register,
    Sandboxed,
    NoDesktopEntry,
}

#[cfg(any(target_os = "linux", test))]
fn linux_plan(
    flatpak_id: Option<&str>,
    snap_name: Option<&str>,
    entry_installed: bool,
) -> LinuxPlan {
    // Matched against Glyph's own ids: a snap terminal exports its variables to every child.
    let in_flatpak = flatpak_id == Some(FLATPAK_ID);
    let in_snap = snap_name == Some(SNAP_NAME);
    // `xdg-mime` in a sandbox writes a private mimeapps.list the host session never reads.
    if in_flatpak || in_snap {
        return LinuxPlan::Sandboxed;
    }
    if !entry_installed {
        return LinuxPlan::NoDesktopEntry;
    }
    LinuxPlan::Register
}

/// Every directory the desktop session reads entries from: the user's data
/// directory, then `XDG_DATA_DIRS` or the default the XDG Base Directory spec
/// gives it.
#[cfg(any(target_os = "linux", test))]
fn applications_dirs(
    user_data: Option<PathBuf>,
    xdg_data_dirs: Option<OsString>,
    appdir: Option<OsString>,
) -> Vec<PathBuf> {
    let listed = xdg_data_dirs.unwrap_or_default();
    // The spec has implementations ignore relative entries.
    let mut system: Vec<PathBuf> = std::env::split_paths(&listed)
        .filter(|dir| dir.is_absolute())
        .collect();
    if system.is_empty() {
        system = vec!["/usr/local/share".into(), "/usr/share".into()];
    }
    // An AppImage lists its own mount, and the session never reads the entry bundled in it.
    let mount = appdir.map(PathBuf::from).filter(|dir| dir.is_absolute());
    let in_mount = |dir: &PathBuf| mount.as_ref().is_some_and(|mount| dir.starts_with(mount));
    user_data
        .into_iter()
        .chain(system)
        .filter(|dir| !in_mount(dir))
        .map(|dir| dir.join("applications"))
        .collect()
}

#[cfg(any(target_os = "linux", test))]
fn desktop_entry_installed(applications_dirs: &[PathBuf]) -> bool {
    applications_dirs
        .iter()
        .any(|dir| dir.join(DESKTOP_ENTRY).is_file())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registers_an_unsandboxed_install_whose_entry_is_installed() {
        assert_eq!(linux_plan(None, None, true), LinuxPlan::Register);
    }

    #[test]
    fn a_missing_entry_is_reported_instead_of_registered() {
        assert_eq!(linux_plan(None, None, false), LinuxPlan::NoDesktopEntry);
    }

    #[test]
    fn flatpak_and_snap_installs_are_sandboxed() {
        assert_eq!(
            linux_plan(Some(FLATPAK_ID), None, false),
            LinuxPlan::Sandboxed
        );
        assert_eq!(
            linux_plan(None, Some(SNAP_NAME), false),
            LinuxPlan::Sandboxed
        );
        // A system package installed next to the sandboxed one changes nothing.
        assert_eq!(
            linux_plan(Some(FLATPAK_ID), None, true),
            LinuxPlan::Sandboxed
        );
        assert_eq!(
            linux_plan(None, Some(SNAP_NAME), true),
            LinuxPlan::Sandboxed
        );
    }

    #[test]
    fn another_apps_sandbox_variables_do_not_make_glyph_sandboxed() {
        assert_eq!(
            linux_plan(Some("org.gnome.Ptyxis"), Some("code"), true),
            LinuxPlan::Register
        );
        assert_eq!(
            linux_plan(Some("org.gnome.Ptyxis"), Some("code"), false),
            LinuxPlan::NoDesktopEntry
        );
    }

    #[test]
    fn applications_dirs_default_to_the_spec_locations() {
        let expected = vec![
            PathBuf::from("/usr/local/share/applications"),
            PathBuf::from("/usr/share/applications"),
        ];
        assert_eq!(applications_dirs(None, None, None), expected);
        assert_eq!(
            applications_dirs(None, Some(OsString::new()), None),
            expected
        );
    }

    #[test]
    fn applications_dirs_cover_the_user_directory_and_the_listed_ones() {
        let root = tempfile::tempdir().unwrap();
        let user = root.path().join("user");
        let first = root.path().join("first");
        let second = root.path().join("second");
        let listed = std::env::join_paths([&first, &second]).unwrap();

        assert_eq!(
            applications_dirs(Some(user.clone()), Some(listed), None),
            vec![
                user.join("applications"),
                first.join("applications"),
                second.join("applications"),
            ]
        );
    }

    #[test]
    fn applications_dirs_ignore_relative_entries() {
        let root = tempfile::tempdir().unwrap();
        let absolute = root.path().join("share");
        let listed =
            std::env::join_paths([PathBuf::from("relative/share"), absolute.clone()]).unwrap();

        assert_eq!(
            applications_dirs(None, Some(listed), None),
            vec![absolute.join("applications")]
        );
        assert_eq!(
            applications_dirs(None, Some(OsString::from("relative/share")), None),
            applications_dirs(None, None, None)
        );
    }

    #[test]
    fn applications_dirs_leave_out_the_appimage_mount() {
        let root = tempfile::tempdir().unwrap();
        let mount = root.path().join("mount");
        let system = root.path().join("system");
        // What the AppImage's launch hook exports: its own share directory first.
        let listed = std::env::join_paths([mount.join("usr/share"), system.clone()]).unwrap();
        let outside_the_mount = vec![system.join("applications")];

        assert_eq!(
            applications_dirs(None, Some(listed.clone()), Some(mount.into_os_string())),
            outside_the_mount
        );
        // An AppImage that started Glyph hands down its own mount, which holds nothing of ours.
        let other_mount = root.path().join("other").into_os_string();
        assert_eq!(
            applications_dirs(None, Some(listed.clone()), Some(other_mount)).len(),
            2
        );
        // An empty path is a prefix of every path, so it must not count as a mount.
        assert_eq!(
            applications_dirs(None, Some(listed), Some(OsString::new())).len(),
            2
        );
    }

    #[test]
    fn the_entry_is_found_in_any_applications_dir() {
        let root = tempfile::tempdir().unwrap();
        let empty = root.path().join("empty");
        let holding = root.path().join("holding");
        std::fs::create_dir_all(&empty).unwrap();
        std::fs::create_dir_all(&holding).unwrap();
        let dirs = [empty, holding.clone(), root.path().join("absent")];

        assert!(!desktop_entry_installed(&dirs));

        std::fs::write(holding.join(format!("{FLATPAK_ID}.desktop")), "").unwrap();
        assert!(!desktop_entry_installed(&dirs));

        std::fs::write(holding.join(DESKTOP_ENTRY), "").unwrap();
        assert!(desktop_entry_installed(&dirs));
    }

    #[test]
    fn the_packaging_recipes_agree_with_the_names_assumed_here() {
        let snap = include_str!("../../../snap/snapcraft.yaml");
        let flatpak = include_str!("../../../flatpak/com.hamidfzm.glyph.yml");

        // The snap repacks the .deb, so its recipe names the entry the bundler wrote.
        assert!(snap.contains(&format!("usr/share/applications/{DESKTOP_ENTRY}")));
        assert!(snap
            .lines()
            .any(|line| line == format!("name: {SNAP_NAME}")));
        assert!(flatpak
            .lines()
            .any(|line| line == format!("id: {FLATPAK_ID}")));
    }
}
