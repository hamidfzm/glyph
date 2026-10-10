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
    /// argv with the program name at index 0, every entry valid Unicode. A
    /// dropped argument leaves an empty string where it stood.
    pub args: Vec<String>,
    /// Arguments that are not valid Unicode. A path crosses IPC as a string,
    /// so a file named this way cannot be opened; the caller reports it.
    pub dropped: Vec<OsString>,
}

/// Split raw arguments into the usable and the dropped. The program name is
/// kept whatever it holds, lossily if need be: it is a position, never a path.
///
/// A dropped argument is replaced by an empty string, which every scanner
/// skips, instead of being removed. Removing it would shift what follows:
/// `glyph <dropped> export` would turn into the `export` subcommand, and a
/// flag would take the next flag as its value.
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
            Err(arg) => {
                args.push(String::new());
                dropped.push(arg);
            }
        }
    }
    LaunchArgs { args, dropped }
}

/// `exe` again with `args`, whose index 0 is the program name the new process
/// sets for itself. Running it replaces this process, which no test can
/// survive, so that half lives beside `run()` in lib.rs.
#[cfg(desktop)]
pub fn relaunch_command(exe: &Path, args: &[String]) -> Command {
    let mut command = Command::new(exe);
    command.args(args.iter().skip(1));
    command
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
        assert_eq!(split.args, ["glyph", "a.md", "", "b.md"]);
        assert_eq!(split.dropped, [not_unicode()]);
    }

    #[test]
    fn a_dropped_argument_does_not_shift_the_ones_after_it() {
        // Removed outright, the first would make `export` the first argument
        // (a subcommand) and the second would hand `--format` to `--out`.
        let mut raw = vec![OsString::from("glyph"), not_unicode()];
        raw.push(OsString::from("export"));
        assert_eq!(split_unicode(raw).args, ["glyph", "", "export"]);

        let mut raw = os(&["glyph", "export", "notes.md", "--out"]);
        raw.push(not_unicode());
        raw.extend(os(&["--format", "pdf"]));
        assert_eq!(
            split_unicode(raw).args,
            ["glyph", "export", "notes.md", "--out", "", "--format", "pdf"]
        );
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
    fn the_relaunch_runs_the_same_executable_with_the_usable_arguments() {
        // The placeholder goes along, so positions hold in the new process too.
        let args = ["glyph", "a.md", "", "b.md"].map(String::from);
        let command = relaunch_command(Path::new("/opt/glyph/glyph"), &args);

        assert_eq!(command.get_program(), "/opt/glyph/glyph");
        let relaunched: Vec<_> = command.get_args().collect();
        assert_eq!(relaunched, ["a.md", "", "b.md"]);
    }
}
