use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, ExitStatus};
use tauri::State;

/// What the command asks of the machine it runs on. Running it for real
/// rewrites that machine's default apps, so tests answer with a fake.
pub trait Host: Send + Sync {
    /// The platform to act for, as `std::env::consts::OS` names it.
    fn os(&self) -> &str;
    fn var(&self, name: &str) -> Option<OsString>;
    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<ExitStatus>;
}

pub struct ProcessHost;

impl Host for ProcessHost {
    fn os(&self) -> &str {
        std::env::consts::OS
    }

    fn var(&self, name: &str) -> Option<OsString> {
        std::env::var_os(name)
    }

    fn run(&self, program: &str, args: &[&str]) -> std::io::Result<ExitStatus> {
        Command::new(program).args(args).status()
    }
}

/// The host `set_default_markdown_app` acts on, as managed state.
pub struct DefaultAppHost(pub Box<dyn Host>);

/// The desktop entry of the .deb, the .rpm and every package built from one.
/// The Tauri bundler names it after the product name, not the bundle identifier.
const DESKTOP_ENTRY: &str = concat!(env!("GLYPH_PRODUCT_NAME"), ".desktop");

/// The Flatpak app id (`flatpak/com.hamidfzm.glyph.yml`) is the bundle identifier.
const FLATPAK_ID: &str = env!("GLYPH_IDENTIFIER");

/// `name:` in `snap/snapcraft.yaml`.
const SNAP_NAME: &str = "glyph";

#[derive(Debug, PartialEq)]
enum LinuxPlan {
    Register,
    Sandboxed,
    NoDesktopEntry,
}

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

/// `XDG_DATA_HOME`, or the default the XDG Base Directory spec gives it.
fn user_data_dir(xdg_data_home: Option<OsString>, home: Option<OsString>) -> Option<PathBuf> {
    let configured = xdg_data_home.map(PathBuf::from);
    let default = home.map(|home| PathBuf::from(home).join(".local/share"));
    // The spec has implementations ignore a relative value.
    configured
        .filter(|dir| dir.is_absolute())
        .or(default)
        .filter(|dir| dir.is_absolute())
}

/// Every directory the desktop session reads entries from: the user's data
/// directory, then `XDG_DATA_DIRS` or the default the XDG Base Directory spec
/// gives it.
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

fn desktop_entry_installed(applications_dirs: &[PathBuf]) -> bool {
    applications_dirs
        .iter()
        .any(|dir| dir.join(DESKTOP_ENTRY).is_file())
}

fn set_default_on_linux(host: &dyn Host) -> Result<String, String> {
    let entry_installed = desktop_entry_installed(&applications_dirs(
        user_data_dir(host.var("XDG_DATA_HOME"), host.var("HOME")),
        host.var("XDG_DATA_DIRS"),
        host.var("APPDIR"),
    ));
    let id = |name| host.var(name).and_then(|value| value.into_string().ok());
    let plan = linux_plan(
        id("FLATPAK_ID").as_deref(),
        id("SNAP_NAME").as_deref(),
        entry_installed,
    );
    match plan {
        LinuxPlan::Sandboxed => Ok("sandboxed".into()),
        LinuxPlan::NoDesktopEntry => Ok("noDesktopEntry".into()),
        LinuxPlan::Register => {
            // Cover the common MIME spellings file managers use for Markdown.
            for mime in ["text/markdown", "text/x-markdown"] {
                let status = host
                    .run("xdg-mime", &["default", DESKTOP_ENTRY, mime])
                    .map_err(|e| format!("xdg-mime is unavailable: {e}"))?;
                if !status.success() {
                    return Err(format!("xdg-mime exited with {status}"));
                }
            }
            Ok("registered".into())
        }
    }
}

fn open_default_apps_settings(host: &dyn Host) -> Result<String, String> {
    // Windows 10+ forbids silently changing the default handler; open the
    // Default Apps settings page so the user can assign Glyph to Markdown.
    host.run("cmd", &["/C", "start", "", "ms-settings:defaultapps"])
        .map_err(|e| format!("failed to open Default Apps settings: {e}"))?;
    Ok("openedSettings".into())
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
pub fn set_default_markdown_app(host: State<'_, DefaultAppHost>) -> Result<String, String> {
    let host = host.0.as_ref();
    match host.os() {
        "linux" => set_default_on_linux(host),
        "windows" => open_default_apps_settings(host),
        // On macOS changing the handler needs private LaunchServices calls, so
        // the UI shows Get Info -> Open With guidance instead.
        _ => Ok("guidance".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri::Manager;

    type Ran = Vec<Vec<String>>;

    /// A machine that answers from what a test gives it and records what it is
    /// asked to run.
    struct FakeHost {
        os: &'static str,
        vars: Vec<(&'static str, OsString)>,
        /// What every program ends with, or `None` when it cannot start.
        exit_code: Option<i32>,
        ran: Arc<Mutex<Ran>>,
    }

    impl Host for FakeHost {
        fn os(&self) -> &str {
            self.os
        }

        fn var(&self, name: &str) -> Option<OsString> {
            let (_, value) = self.vars.iter().find(|(key, _)| *key == name)?;
            Some(value.clone())
        }

        fn run(&self, program: &str, args: &[&str]) -> std::io::Result<ExitStatus> {
            let mut command = vec![program.to_string()];
            command.extend(args.iter().map(|arg| arg.to_string()));
            self.ran.lock().unwrap().push(command);
            match self.exit_code {
                Some(code) => Ok(exit_status(code)),
                None => Err(std::io::ErrorKind::NotFound.into()),
            }
        }
    }

    fn exit_status(code: i32) -> ExitStatus {
        #[cfg(unix)]
        {
            use std::os::unix::process::ExitStatusExt;
            ExitStatus::from_raw(code << 8)
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::ExitStatusExt;
            ExitStatus::from_raw(code as u32)
        }
    }

    /// The command's answer on a fake machine, and the programs it ran there.
    fn set_default(
        os: &'static str,
        vars: Vec<(&'static str, OsString)>,
        exit_code: Option<i32>,
    ) -> (Result<String, String>, Ran) {
        let ran = Arc::new(Mutex::new(Ran::new()));
        let app = tauri::test::mock_app();
        app.manage(DefaultAppHost(Box::new(FakeHost {
            os,
            vars,
            exit_code,
            ran: ran.clone(),
        })));
        let outcome = set_default_markdown_app(app.state());
        let ran = ran.lock().unwrap().clone();
        (outcome, ran)
    }

    /// A data directory under `root` whose `applications` folder holds Glyph's entry.
    fn data_dir_with_entry(root: &Path, name: &str) -> PathBuf {
        let applications = root.join(name).join("applications");
        std::fs::create_dir_all(&applications).unwrap();
        std::fs::write(applications.join(DESKTOP_ENTRY), "").unwrap();
        root.join(name)
    }

    fn registers_both_markdown_types() -> Ran {
        ["text/markdown", "text/x-markdown"]
            .map(|mime| {
                ["xdg-mime", "default", DESKTOP_ENTRY, mime]
                    .map(String::from)
                    .to_vec()
            })
            .to_vec()
    }

    #[test]
    fn linux_registers_the_installed_entry_for_both_markdown_types() {
        let root = tempfile::tempdir().unwrap();
        let system = data_dir_with_entry(root.path(), "system");

        let (outcome, ran) = set_default("linux", vec![("XDG_DATA_DIRS", system.into())], Some(0));

        assert_eq!(outcome, Ok("registered".to_string()));
        assert_eq!(ran, registers_both_markdown_types());
    }

    #[test]
    fn linux_finds_the_entry_in_the_user_data_directory() {
        let root = tempfile::tempdir().unwrap();
        let elsewhere: OsString = root.path().join("empty").into();
        let configured = data_dir_with_entry(root.path(), "configured");
        let home = root.path().join("home");
        data_dir_with_entry(&home, ".local/share");

        let by_variable = vec![
            ("XDG_DATA_HOME", configured.into()),
            ("XDG_DATA_DIRS", elsewhere.clone()),
        ];
        assert_eq!(
            set_default("linux", by_variable, Some(0)).0,
            Ok("registered".to_string())
        );
        let by_default = vec![("HOME", home.into()), ("XDG_DATA_DIRS", elsewhere)];
        assert_eq!(
            set_default("linux", by_default, Some(0)).0,
            Ok("registered".to_string())
        );
    }

    #[test]
    fn linux_reports_a_missing_entry_and_runs_nothing() {
        let root = tempfile::tempdir().unwrap();
        let empty: OsString = root.path().join("empty").into();

        let (outcome, ran) = set_default("linux", vec![("XDG_DATA_DIRS", empty)], Some(0));

        assert_eq!(outcome, Ok("noDesktopEntry".to_string()));
        assert_eq!(ran, Ran::new());
    }

    #[test]
    fn linux_leaves_a_sandboxed_install_alone() {
        let root = tempfile::tempdir().unwrap();
        let system: OsString = data_dir_with_entry(root.path(), "system").into();

        for sandbox in [("SNAP_NAME", SNAP_NAME), ("FLATPAK_ID", FLATPAK_ID)] {
            let vars = vec![
                ("XDG_DATA_DIRS", system.clone()),
                (sandbox.0, sandbox.1.into()),
            ];
            let (outcome, ran) = set_default("linux", vars, Some(0));

            assert_eq!(outcome, Ok("sandboxed".to_string()));
            assert_eq!(ran, Ran::new());
        }
    }

    #[test]
    fn linux_ignores_the_entry_bundled_in_an_appimage() {
        let root = tempfile::tempdir().unwrap();
        let mount = root.path().join("mount");
        let bundled = data_dir_with_entry(&mount, "usr/share");
        let listed = std::env::join_paths([bundled, root.path().join("empty")]).unwrap();

        let vars = vec![("XDG_DATA_DIRS", listed), ("APPDIR", mount.into())];
        let (outcome, ran) = set_default("linux", vars, Some(0));

        assert_eq!(outcome, Ok("noDesktopEntry".to_string()));
        assert_eq!(ran, Ran::new());
    }

    #[test]
    fn linux_reports_an_xdg_mime_that_cannot_start() {
        let root = tempfile::tempdir().unwrap();
        let system = data_dir_with_entry(root.path(), "system");

        let (outcome, ran) = set_default("linux", vec![("XDG_DATA_DIRS", system.into())], None);

        let error = outcome.unwrap_err();
        assert!(error.starts_with("xdg-mime is unavailable: "), "{error}");
        assert_eq!(ran.len(), 1);
    }

    #[test]
    fn linux_stops_at_the_first_registration_xdg_mime_refuses() {
        let root = tempfile::tempdir().unwrap();
        let system = data_dir_with_entry(root.path(), "system");

        let (outcome, ran) = set_default("linux", vec![("XDG_DATA_DIRS", system.into())], Some(2));

        let error = outcome.unwrap_err();
        assert!(error.starts_with("xdg-mime exited with "), "{error}");
        assert_eq!(ran.len(), 1);
    }

    #[test]
    fn windows_opens_the_default_apps_settings() {
        let (outcome, ran) = set_default("windows", Vec::new(), Some(0));

        assert_eq!(outcome, Ok("openedSettings".to_string()));
        let opened = ["cmd", "/C", "start", "", "ms-settings:defaultapps"];
        assert_eq!(ran, vec![opened.map(String::from).to_vec()]);

        let error = set_default("windows", Vec::new(), None).0.unwrap_err();
        assert!(
            error.starts_with("failed to open Default Apps settings: "),
            "{error}"
        );
    }

    #[test]
    fn other_platforms_get_guidance_and_run_nothing() {
        for os in ["macos", "android", "ios"] {
            let (outcome, ran) = set_default(os, Vec::new(), Some(0));

            assert_eq!(outcome, Ok("guidance".to_string()));
            assert_eq!(ran, Ran::new());
        }
    }

    #[test]
    fn the_process_host_reads_this_process() {
        assert_eq!(ProcessHost.os(), std::env::consts::OS);
        assert!(ProcessHost.var("PATH").is_some());
        assert!(ProcessHost.var("GLYPH_NO_SUCH_VARIABLE").is_none());
    }

    #[test]
    fn the_process_host_reports_a_program_that_cannot_start() {
        let root = tempfile::tempdir().unwrap();
        // A full path, so nothing is looked up along `PATH`.
        let missing = root.path().join("no-such-program");

        assert!(ProcessHost.run(missing.to_str().unwrap(), &[]).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn the_process_host_runs_a_program_and_hands_back_its_exit_status() {
        assert!(ProcessHost
            .run("/bin/sh", &["-c", "exit 0"])
            .unwrap()
            .success());
        let failed = ProcessHost.run("/bin/sh", &["-c", "exit 3"]).unwrap();
        assert_eq!(failed.code(), Some(3));
    }

    #[test]
    fn the_user_data_directory_follows_the_spec() {
        let root = tempfile::tempdir().unwrap();
        let configured = root.path().join("data");
        let home = root.path().join("home");
        let home_var = || Some(OsString::from(&home));

        assert_eq!(
            user_data_dir(Some(configured.clone().into()), home_var()),
            Some(configured)
        );
        assert_eq!(
            user_data_dir(Some("relative/data".into()), home_var()),
            Some(home.join(".local/share"))
        );
        assert_eq!(user_data_dir(None, Some("relative/home".into())), None);
        assert_eq!(user_data_dir(None, None), None);
    }

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
