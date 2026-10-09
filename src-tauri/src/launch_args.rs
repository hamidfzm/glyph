//! The process's own argument list, read without the panic `std::env::args`
//! raises on an argument that is not valid Unicode: a legacy-encoded file name
//! on Linux, an unpaired surrogate on Windows.

use std::ffi::OsString;
#[cfg(desktop)]
use std::path::Path;
#[cfg(desktop)]
use std::process::Command;

/// The arguments this process can use, and the ones it had to drop.
#[derive(Debug, PartialEq, Eq)]
pub struct LaunchArgs {
    /// argv with the program name at index 0, every entry valid Unicode.
    pub args: Vec<String>,
    /// Arguments that are not valid Unicode. A path crosses IPC as a string,
    /// so a file named this way cannot be opened; the caller reports it.
    pub dropped: Vec<OsString>,
}

/// Split raw arguments into the usable and the dropped. The program name is
/// kept whatever it holds, lossily if need be: it is a position, never a path.
pub fn split_unicode(raw: impl IntoIterator<Item = OsString>) -> LaunchArgs {
    let mut raw = raw.into_iter();
    let mut args = Vec::new();
    if let Some(program) = raw.next() {
        args.push(program.to_string_lossy().into_owned());
    }
    let mut dropped = Vec::new();
    for arg in raw {
        match arg.into_string() {
            Ok(arg) => args.push(arg),
            Err(arg) => dropped.push(arg),
        }
    }
    LaunchArgs { args, dropped }
}

/// `exe` again with `args`, whose index 0 is the program name the new process
/// sets for itself.
#[cfg(desktop)]
fn relaunch_command(exe: &Path, args: &[String]) -> Command {
    let mut command = Command::new(exe);
    command.args(args.iter().skip(1));
    command
}

/// Start this launch over with `args` as its whole argument list, so nothing
/// in the process can read the dropped ones. The single-instance plugin does
/// (`std::env::args()`) when it forwards a launch, and would panic before any
/// valid path reached the running app. Returns only if the relaunch could not
/// start.
#[cfg(desktop)]
pub fn relaunch(args: &[String]) {
    let err = match std::env::current_exe() {
        Ok(exe) => hand_over_to(relaunch_command(&exe, args)),
        Err(err) => err,
    };
    eprintln!("Could not relaunch without the ignored arguments: {err}");
}

#[cfg(all(desktop, unix))]
fn hand_over_to(mut command: Command) -> std::io::Error {
    use std::os::unix::process::CommandExt;
    // Replaces this process and keeps its pid, so whatever started Glyph is
    // still waiting on the right one.
    command.exec()
}

#[cfg(all(desktop, not(unix)))]
fn hand_over_to(mut command: Command) -> std::io::Error {
    match command.spawn() {
        // The child is the launch now. Only an open launch gets here, and
        // that has no exit status worth waiting for.
        Ok(_) => std::process::exit(0),
        Err(err) => err,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn os(args: &[&str]) -> Vec<OsString> {
        args.iter().map(OsString::from).collect()
    }

    /// A file name no `String` can hold.
    #[cfg(unix)]
    fn not_unicode() -> OsString {
        use std::os::unix::ffi::OsStringExt;
        OsString::from_vec(b"caf\xE9.md".to_vec())
    }

    #[cfg(windows)]
    fn not_unicode() -> OsString {
        use std::os::windows::ffi::OsStringExt;
        // An unpaired surrogate, which NTFS accepts in a file name.
        OsString::from_wide(&[0x0063, 0xD800, 0x002E, 0x006D, 0x0064])
    }

    #[test]
    fn unicode_arguments_pass_through_in_order() {
        let split = split_unicode(os(&["glyph", "a.md", "--quiet", "دفتر.md"]));
        assert_eq!(split.args, ["glyph", "a.md", "--quiet", "دفتر.md"]);
        assert!(split.dropped.is_empty());
    }

    #[test]
    fn an_argument_that_is_not_unicode_is_dropped_and_the_rest_kept() {
        // This is the conversion `std::env::args()` unwraps, and so panics on.
        assert!(not_unicode().into_string().is_err());

        let mut raw = os(&["glyph", "a.md"]);
        raw.push(not_unicode());
        raw.push(OsString::from("b.md"));

        let split = split_unicode(raw);
        assert_eq!(split.args, ["glyph", "a.md", "b.md"]);
        assert_eq!(split.dropped, [not_unicode()]);
    }

    #[test]
    fn the_program_name_keeps_its_place_even_when_it_is_not_unicode() {
        // Dropping it would shift the first real argument into index 0, where
        // every scanner skips it.
        let split = split_unicode([not_unicode(), OsString::from("a.md")]);
        assert_eq!(split.args.len(), 2);
        assert_eq!(split.args[1], "a.md");
        assert!(split.dropped.is_empty());
    }

    #[test]
    fn no_arguments_at_all_is_an_empty_list() {
        let split = split_unicode(Vec::new());
        assert!(split.args.is_empty());
        assert!(split.dropped.is_empty());
    }

    #[cfg(desktop)]
    #[test]
    fn the_relaunch_runs_the_same_executable_with_the_kept_arguments_only() {
        let args = ["glyph", "a.md", "b.md"].map(String::from);
        let command = relaunch_command(Path::new("/opt/glyph/glyph"), &args);

        assert_eq!(command.get_program(), "/opt/glyph/glyph");
        let relaunched: Vec<_> = command.get_args().collect();
        assert_eq!(relaunched, ["a.md", "b.md"]);
    }
}
