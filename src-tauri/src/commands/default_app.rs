// What "set Glyph as the default Markdown app" can do on Linux, decided from
// facts the command reads off the process. The command itself, which spawns
// `xdg-mime`, is in [`super::default_app_runtime`].

use std::ffi::OsString;
use std::path::PathBuf;

/// The desktop entry of the .deb, the .rpm and every package built from one.
/// The Tauri bundler names it after the product name, not the bundle identifier.
pub(super) const DESKTOP_ENTRY: &str = concat!(env!("GLYPH_PRODUCT_NAME"), ".desktop");

/// The Flatpak app id (`flatpak/com.hamidfzm.glyph.yml`) is the bundle identifier.
const FLATPAK_ID: &str = crate::data_dir::IDENTIFIER;

/// `name:` in `snap/snapcraft.yaml`.
const SNAP_NAME: &str = "glyph";

#[derive(Debug, PartialEq)]
pub(super) enum LinuxPlan {
    Register,
    Sandboxed,
    NoDesktopEntry,
}

pub(super) fn linux_plan(
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
pub(super) fn applications_dirs(
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

pub(super) fn desktop_entry_installed(applications_dirs: &[PathBuf]) -> bool {
    applications_dirs
        .iter()
        .any(|dir| dir.join(DESKTOP_ENTRY).is_file())
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
        let smoke = include_str!("../../../scripts/desktop-entry-smoke.sh");
        let snap = include_str!("../../../snap/snapcraft.yaml");
        let flatpak = include_str!("../../../flatpak/com.hamidfzm.glyph.yml");

        // CI opens a built .deb with that script, and the snap repacks the .deb.
        let installed = format!("usr/share/applications/{DESKTOP_ENTRY}");
        assert!(smoke.contains(&installed));
        assert!(snap.contains(&installed));
        assert!(snap
            .lines()
            .any(|line| line == format!("name: {SNAP_NAME}")));
        assert!(flatpak
            .lines()
            .any(|line| line == format!("id: {FLATPAK_ID}")));
    }
}
