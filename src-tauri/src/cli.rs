// The `#[cfg(desktop)]` items are the CLI launch-plan half; the ungated
// classifiers stay in use by the drag-drop and file-association handlers.

use std::path::{Path, PathBuf};

use crate::is_supported_file;

/// Pick the first non-flag argument from a second-instance argv. The slice is
/// expected to be the full argv including the program name at index 0, which
/// `tauri-plugin-single-instance` hands to its callback verbatim.
///
/// Anything starting with `-` is treated as a flag and skipped, matching the
/// way the OS hands us file-association launches: `glyph /path/to/file.md`.
pub fn pick_path_arg(argv: &[String]) -> Option<&str> {
    argv.iter()
        .skip(1)
        .find(|a| !a.is_empty() && !a.starts_with('-'))
        .map(String::as_str)
}

/// What an initial-launch path resolves to. Shared by every entry that turns
/// a user-supplied path into an "open this" intent — CLI args, macOS
/// `RunEvent::Opened`, and the single-instance plugin callback. Callers pick
/// what to do with each variant (store in managed state, emit a frontend
/// event, or warn + skip).
#[derive(Debug, PartialEq, Eq)]
pub enum InitialOpenAction {
    /// Open as a folder workspace. Inner is the absolute path.
    Folder(String),
    /// Open as a single markdown file. Inner is the absolute path.
    File(String),
    /// Path exists and resolves, but is not a supported document (markdown or
    /// `.ipynb`) — e.g. `.txt`, `.html`. The caller should log a warning and
    /// skip it rather than forwarding it to the renderer, which would otherwise
    /// treat the content as markdown and allow embedded HTML / JS through the
    /// sanitizer. Inner is the absolute path for the log message.
    RejectedUnsupported(String),
}

/// Classify a path that's already been resolved to a canonical absolute form.
/// Used by macOS `RunEvent::Opened` where the OS hands us a `file://` URL we
/// can `to_file_path()` directly — no relative-to-cwd resolution needed.
///
/// Returns `None` for paths that don't exist or aren't regular files /
/// directories (e.g. broken symlinks, sockets, FIFOs).
pub fn classify_resolved_path(canonical: &Path) -> Option<InitialOpenAction> {
    let abs = canonical.to_string_lossy().to_string();
    if canonical.is_dir() {
        Some(InitialOpenAction::Folder(abs))
    } else if canonical.is_file() {
        if is_supported_file(canonical) {
            Some(InitialOpenAction::File(abs))
        } else {
            Some(InitialOpenAction::RejectedUnsupported(abs))
        }
    } else {
        None
    }
}

/// Resolve a user-supplied path string against `cwd` and classify the
/// result. Used by the CLI argument parser at first launch — the user may
/// pass a relative path; classification needs to happen against the
/// canonicalized form so symlinks and `..` traversal are normalised.
pub fn classify_initial_arg(path_str: &str, cwd: &Path) -> Option<InitialOpenAction> {
    let canonical = resolve_initial_path(path_str, cwd)?;
    classify_resolved_path(&canonical)
}

/// Pick the initial path to open at first launch from the two sources we
/// have available, in order:
///
/// 1. `plugin_path` — the value `tauri-plugin-cli` parsed out of its
///    configured args. Works when the OS hands us the file via association,
///    or when the user runs the binary directly.
/// 2. `env_args` — the raw process argv, scanned by [`pick_path_arg`]. This
///    is the Windows-friendly path: `pnpm tauri dev -- samples` can land
///    `samples` in argv without ever populating the plugin's matches, so we
///    fall back to argv when the plugin yields nothing.
#[cfg(desktop)]
pub fn initial_open_action(
    plugin_path: Option<&str>,
    env_args: &[String],
    cwd: &Path,
) -> Option<InitialOpenAction> {
    let path_str = plugin_path
        .map(str::to_string)
        .or_else(|| pick_path_arg(env_args).map(str::to_string))?;
    classify_initial_arg(&path_str, cwd)
}

/// The frontend event a second-instance launch should fire on the running
/// window, plus the absolute path payload. Returned by [`second_instance_event`].
#[derive(Debug, PartialEq, Eq)]
pub struct SecondInstanceEvent {
    pub event_name: &'static str,
    pub path: String,
}

/// Decide what (if anything) a second instance should tell the running app to
/// open. Picks the first non-flag arg out of `argv`, resolves it against
/// `cwd`, and classifies the result. Non-markdown files are silently rejected
/// here (the running app already logged the warning at first launch if it
/// hit one).
pub fn second_instance_event(argv: &[String], cwd: &Path) -> Option<SecondInstanceEvent> {
    let path_arg = pick_path_arg(argv)?;
    match classify_initial_arg(path_arg, cwd)? {
        InitialOpenAction::Folder(path) => Some(SecondInstanceEvent {
            event_name: "open-folder",
            path,
        }),
        InitialOpenAction::File(path) => Some(SecondInstanceEvent {
            event_name: "open-file",
            path,
        }),
        InitialOpenAction::RejectedUnsupported(_) => None,
    }
}

/// Value of a `--flag value` / `--flag=value` pair in argv, if present. The
/// argv fallback for `tauri-plugin-cli` flags, mirroring [`pick_path_arg`].
#[cfg(desktop)]
pub fn pick_flag_value<'a>(argv: &'a [String], flag: &str) -> Option<&'a str> {
    let prefix = format!("{flag}=");
    let mut iter = argv.iter().skip(1);
    while let Some(arg) = iter.next() {
        if arg == flag {
            return iter.next().map(String::as_str);
        }
        if let Some(rest) = arg.strip_prefix(&prefix) {
            return Some(rest);
        }
    }
    None
}

/// Remove `--flag value` / `--flag=value` from argv so positional scanning
/// ([`pick_path_arg`]) can't mistake the flag's value for the path argument.
#[cfg(desktop)]
pub fn strip_flag(argv: &[String], flag: &str) -> Vec<String> {
    let prefix = format!("{flag}=");
    let mut out = Vec::new();
    let mut iter = argv.iter();
    while let Some(arg) = iter.next() {
        if arg == flag {
            iter.next();
            continue;
        }
        if arg.starts_with(&prefix) {
            continue;
        }
        out.push(arg.clone());
    }
    out
}

/// Whether a `--flag` / `--flag=value` appears in argv at all, regardless of
/// whether it carries a value. Distinguishes "no `--export`" (a normal launch)
/// from "`--export` with nothing after it" (a usage error).
#[cfg(desktop)]
pub fn has_flag(argv: &[String], flag: &str) -> bool {
    let prefix = format!("{flag}=");
    argv.iter()
        .skip(1)
        .any(|a| a == flag || a.starts_with(&prefix))
}

/// Resolve an output path against `cwd`. Unlike input paths it does not need
/// to exist yet, so there is no canonicalize.
#[cfg(desktop)]
pub fn resolve_out_path(path_str: &str, cwd: &Path) -> Option<String> {
    if path_str.trim().is_empty() {
        return None;
    }
    let path = Path::new(path_str);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        cwd.join(path)
    };
    Some(absolute.to_string_lossy().to_string())
}

/// What `--export` can produce. Every variant but `Site` renders the single
/// input document; `Site` renders a whole workspace folder.
#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExportFormat {
    Pdf,
    Docx,
    Epub,
    Html,
    Site,
}

#[cfg(desktop)]
impl ExportFormat {
    /// Every format, in the order `--help` lists them.
    pub const ALL: [ExportFormat; 5] = [
        ExportFormat::Pdf,
        ExportFormat::Docx,
        ExportFormat::Epub,
        ExportFormat::Html,
        ExportFormat::Site,
    ];

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "pdf" => Some(Self::Pdf),
            "docx" => Some(Self::Docx),
            "epub" => Some(Self::Epub),
            "html" => Some(Self::Html),
            "site" => Some(Self::Site),
            _ => None,
        }
    }

    /// The spelling accepted on the command line, also what the frontend
    /// export runner dispatches on.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Pdf => "pdf",
            Self::Docx => "docx",
            Self::Epub => "epub",
            Self::Html => "html",
            Self::Site => "site",
        }
    }

    /// Extension for the default output path. `Site` writes a directory, so it
    /// has none and always needs an explicit `--out`.
    pub fn extension(self) -> Option<&'static str> {
        match self {
            Self::Site => None,
            Self::Pdf => Some("pdf"),
            Self::Docx => Some("docx"),
            Self::Epub => Some("epub"),
            Self::Html => Some("html"),
        }
    }
}

/// Address `glyph serve` binds when `--host` is absent. Loopback only: the
/// exported site is readable by anyone who can reach the port, so exposing it
/// to the network is opt-in rather than the default.
#[cfg(desktop)]
pub const DEFAULT_SERVE_HOST: std::net::IpAddr =
    std::net::IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);

/// Port `glyph serve` binds when `--port` is absent.
#[cfg(desktop)]
pub const DEFAULT_SERVE_PORT: u16 = 4173;

/// What this process launch should do, decided from the CLI once at startup.
#[cfg(desktop)]
#[derive(Debug, PartialEq, Eq)]
pub enum CliLaunch {
    /// Normal interactive launch, optionally opening a path.
    Open(Option<InitialOpenAction>),
    /// Headless export: render `input` into `output` and exit. `input` is a
    /// workspace folder for `Site` and a document for every other format.
    Export {
        input: String,
        format: ExportFormat,
        output: String,
    },
    /// Long-running preview: render `root` as a website, serve it on
    /// `host:port`, and re-render whenever the folder changes. `output` is
    /// `None` when the caller passed no `--out`, meaning the site belongs in a
    /// temporary directory the process owns and removes when interrupted.
    Serve {
        root: String,
        host: std::net::IpAddr,
        port: u16,
        output: Option<String>,
    },
}

/// Whether argv asks for the `serve` subcommand. Only a bare first argument
/// counts, so a folder that happens to be named `serve` still opens normally
/// as `glyph ./serve`.
#[cfg(desktop)]
pub fn is_serve_invocation(env_args: &[String]) -> bool {
    env_args.get(1).is_some_and(|arg| arg == "serve")
}

/// Whether this launch should hand its arguments to a Glyph the user already
/// has open, rather than doing the work itself.
///
/// Opening a document should reuse the running window. An export and a serve
/// must not: both do their work in this process, so forwarding would exit 0
/// having exported nothing, or having served nothing while the running app
/// quietly opened the folder in a tab instead.
#[cfg(desktop)]
pub fn forwards_to_running_instance(env_args: &[String]) -> bool {
    !has_flag(env_args, "--export") && !is_serve_invocation(env_args)
}

/// Whether `candidate` sits inside `root`, comparing the deepest existing
/// ancestor of a path that does not exist yet. Serving a site from inside the
/// folder being watched would feed the export's own output back into it, so
/// the CLI rejects it the same way the in-app website export does.
#[cfg(desktop)]
fn is_path_inside(candidate: &Path, root: &Path) -> bool {
    let Ok(root) = root.canonicalize() else {
        return false;
    };
    let mut probe = candidate.to_path_buf();
    loop {
        if let Ok(resolved) = probe.canonicalize() {
            return resolved.starts_with(&root);
        }
        // Not created yet: ask the same question of its parent.
        if !probe.pop() {
            return false;
        }
    }
}

/// Parse a `glyph serve <dir> [--host <h>] [--port <n>] [--out <dir>]` launch.
/// `Err` is a usage message the caller prints before exiting nonzero.
#[cfg(desktop)]
fn serve_plan(env_args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    // Flag values are stripped before the positional scan so `glyph serve
    // --out build docs` cannot mistake "build" for the folder to serve.
    let positional = strip_flag(
        &strip_flag(
            &strip_flag(&strip_flag(env_args, "--host"), "--port"),
            "--out",
        ),
        "-o",
    );
    // Skip the program name and the `serve` token itself.
    let path_arg = positional
        .iter()
        .skip(2)
        .find(|arg| !arg.is_empty() && !arg.starts_with('-'))
        .ok_or_else(|| format!("glyph serve needs a folder: {SERVE_USAGE}"))?;

    let root = match classify_initial_arg(path_arg, cwd) {
        Some(InitialOpenAction::Folder(root)) => root,
        _ => {
            return Err(format!(
                "glyph serve requires an existing folder, not {}: {SERVE_USAGE}",
                plain_path(path_arg)
            ))
        }
    };

    for flag in ["--host", "--port", "--out"] {
        if has_flag(env_args, flag) && pick_flag_value(env_args, flag).is_none() {
            return Err(format!("{flag} needs a value: {SERVE_USAGE}"));
        }
    }

    let host = match pick_flag_value(env_args, "--host") {
        Some(value) => value
            .trim()
            .parse::<std::net::IpAddr>()
            .map_err(|_| format!("--host is not a valid address: '{value}'"))?,
        None => DEFAULT_SERVE_HOST,
    };

    let port = match pick_flag_value(env_args, "--port") {
        Some(value) => value
            .trim()
            .parse::<u16>()
            .map_err(|_| format!("--port must be a number between 0 and 65535: '{value}'"))?,
        None => DEFAULT_SERVE_PORT,
    };

    let out_value = pick_flag_value(env_args, "--out").or_else(|| pick_flag_value(env_args, "-o"));
    let output = match out_value {
        Some(value) => {
            let resolved =
                resolve_out_path(value, cwd).ok_or_else(|| "--out needs a path".to_string())?;
            if is_path_inside(Path::new(&resolved), Path::new(&root)) {
                return Err(
                    "--out cannot be inside the folder being served: the export would feed its own output back in"
                        .to_string(),
                );
            }
            // The other direction matters just as much: everything in the
            // output directory is served, so `--out .` or `--out ~` would
            // publish the sources, and any `.env` or `.git` beside them.
            if is_path_inside(Path::new(&root), Path::new(&resolved)) {
                return Err(
                    "--out cannot contain the folder being served: everything in it would be published"
                        .to_string(),
                );
            }
            Some(resolved)
        }
        None => None,
    };

    Ok(CliLaunch::Serve {
        root,
        host,
        port,
        output,
    })
}

/// The `serve` usage line, repeated by every one of its error messages.
#[cfg(desktop)]
const SERVE_USAGE: &str = "glyph serve <folder> [--host <host>] [--port <port>] [--out <dir>]";

/// Combine the positional path with `--export` and `--out` into a launch plan.
/// `Err` is a usage error the caller should print before exiting nonzero.
#[cfg(desktop)]
pub fn launch_plan(
    plugin_path: Option<&str>,
    plugin_export: Option<&str>,
    plugin_out: Option<&str>,
    env_args: &[String],
    cwd: &Path,
) -> Result<CliLaunch, String> {
    // `serve` is the one subcommand, so it is decided before any of the
    // flag parsing below, which is shaped around a single positional path.
    if is_serve_invocation(env_args) {
        return serve_plan(env_args, cwd);
    }

    // The flags and their values are stripped before the positional scan so
    // `glyph --export pdf notes.md` cannot mistake "pdf" for the input path.
    let positional = strip_flag(
        &strip_flag(&strip_flag(env_args, "--export"), "--out"),
        "-o",
    );
    let action = initial_open_action(plugin_path, &positional, cwd);

    let export_value = plugin_export
        .map(str::to_string)
        .or_else(|| pick_flag_value(env_args, "--export").map(str::to_string));
    let requested = plugin_export.is_some() || has_flag(env_args, "--export");
    if !requested {
        // `--out` alone would have had its value stripped from the positional
        // scan for an export that was never asked for, quietly opening an empty
        // window instead of the file the user named.
        if plugin_out.is_some() || has_flag(env_args, "--out") || has_flag(env_args, "-o") {
            return Err("--out only applies to an export: add --export <format>".to_string());
        }
        return Ok(CliLaunch::Open(action));
    }
    let value = export_value.unwrap_or_default();
    if value.trim().is_empty() {
        return Err(format!("--export needs a format: {}", format_list()));
    }
    let format = ExportFormat::parse(&value)
        .ok_or_else(|| format!("unknown export format '{value}': {}", format_list()))?;

    let out_value = plugin_out
        .map(str::to_string)
        .or_else(|| pick_flag_value(env_args, "--out").map(str::to_string))
        .or_else(|| pick_flag_value(env_args, "-o").map(str::to_string));
    let output = out_value
        .as_deref()
        .map(|out| resolve_out_path(out, cwd).ok_or_else(|| "--out needs a path".to_string()))
        .transpose()?;

    match (format, action) {
        (ExportFormat::Site, Some(InitialOpenAction::Folder(root))) => {
            let output = output.ok_or_else(|| {
                "--export site needs an output directory: glyph <folder> --export site --out <dir>"
                    .to_string()
            })?;
            Ok(CliLaunch::Export {
                input: root,
                format,
                output,
            })
        }
        (ExportFormat::Site, _) => Err(
            "--export site requires an existing workspace folder: glyph <folder> --export site --out <dir>"
                .to_string(),
        ),
        (_, Some(InitialOpenAction::File(input))) => {
            // A canvas board and a D2 file are "supported documents" for
            // opening, but neither renders as one `.markdown-body`: a canvas
            // would export a single card as if it were the whole board.
            if !is_exportable_document(Path::new(&input)) {
                return Err(format!(
                    "--export {} only takes a markdown or notebook document, not {}",
                    format.as_str(),
                    plain_path(&input)
                ));
            }
            let output = output.unwrap_or_else(|| default_output(&input, format));
            Ok(CliLaunch::Export {
                input,
                format,
                output,
            })
        }
        (_, _) => Err(format!(
            "--export {} requires an existing document: glyph <file.md> --export {} [--out <path>]",
            format.as_str(),
            format.as_str()
        )),
    }
}

/// Drop the Windows extended-length prefix a canonicalized path carries
/// (`\\?\C:\...`, or `\\?\UNC\server\share\...` for a network
/// path). Both work for a write but read as noise in the paths the CLI
/// prints, and the UNC form is not even a valid path once the prefix is
/// dropped naively.
#[cfg(desktop)]
pub fn plain_path(path: &str) -> String {
    match path.strip_prefix(r"\\?\UNC\") {
        Some(rest) => format!(r"\\{rest}"),
        None => path.strip_prefix(r"\\?\").unwrap_or(path).to_string(),
    }
}

/// Whether a document export can render this input. Canvas boards and D2
/// files open fine but do not render as a single document body, so exporting
/// one would silently write a fragment (a canvas exports its first card).
#[cfg(desktop)]
fn is_exportable_document(path: &Path) -> bool {
    crate::is_markdown_file(path) || crate::is_notebook_file(path)
}

/// Output path for an export with no `--out`: the input with the format's
/// extension, so `glyph notes.md --export pdf` writes `notes.pdf` beside it.
#[cfg(desktop)]
fn default_output(input: &str, format: ExportFormat) -> String {
    let extension = format.extension().unwrap_or_default();
    Path::new(&plain_path(input))
        .with_extension(extension)
        .to_string_lossy()
        .to_string()
}

/// The accepted `--export` values, for usage messages and `--help`.
#[cfg(desktop)]
pub fn format_list() -> String {
    ExportFormat::ALL
        .iter()
        .map(|f| f.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Resolve a CLI-supplied path against the working directory. Returns the
/// canonicalized path if it points at something on disk, otherwise `None`.
///
/// Resolution order:
/// 1. Empty / blank input → None.
/// 2. Absolute path → canonicalize as-is.
/// 3. Relative path → try `cwd/path`, then `cwd/../path` (covers `cargo tauri
///    dev` running from `src-tauri/`). If neither exists, fall back to the
///    cwd-relative variant so canonicalize can still report a meaningful error.
pub fn resolve_initial_path(path_str: &str, cwd: &Path) -> Option<PathBuf> {
    if path_str.is_empty() {
        return None;
    }
    let path = Path::new(path_str);
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        let from_cwd = cwd.join(path);
        if from_cwd.exists() {
            from_cwd
        } else {
            let from_parent = cwd.join("..").join(path);
            if from_parent.exists() {
                from_parent
            } else {
                from_cwd
            }
        }
    };
    absolute.canonicalize().ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_tmp(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "glyph_cli_test_{}_{}_{}",
            name,
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn pick_path_arg_skips_program_name() {
        let argv = vec!["glyph".to_string(), "notes.md".to_string()];
        assert_eq!(pick_path_arg(&argv), Some("notes.md"));
    }

    #[test]
    fn pick_path_arg_skips_flags() {
        let argv = vec![
            "glyph".to_string(),
            "--verbose".to_string(),
            "-q".to_string(),
            "real.md".to_string(),
        ];
        assert_eq!(pick_path_arg(&argv), Some("real.md"));
    }

    #[test]
    fn pick_path_arg_returns_none_when_no_path_arg() {
        let argv = vec!["glyph".to_string()];
        assert_eq!(pick_path_arg(&argv), None);
        let only_flag = vec!["glyph".to_string(), "--help".to_string()];
        assert_eq!(pick_path_arg(&only_flag), None);
    }

    #[test]
    fn pick_path_arg_skips_empty_strings() {
        let argv = vec!["glyph".to_string(), "".to_string(), "real.md".to_string()];
        assert_eq!(pick_path_arg(&argv), Some("real.md"));
    }

    #[test]
    fn second_instance_event_classifies_file_argv() {
        let cwd = unique_tmp("si_file");
        let file = cwd.join("note.md");
        fs::write(&file, "x").unwrap();

        let argv = vec!["glyph".to_string(), "note.md".to_string()];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-file");
        assert_eq!(
            PathBuf::from(&result.path).canonicalize().unwrap(),
            file.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_classifies_folder_argv() {
        let cwd = unique_tmp("si_folder");
        let sub = cwd.join("workspace");
        fs::create_dir_all(&sub).unwrap();

        let argv = vec!["glyph".to_string(), "workspace".to_string()];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-folder");
        assert_eq!(
            PathBuf::from(&result.path).canonicalize().unwrap(),
            sub.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_when_no_path_arg() {
        let cwd = unique_tmp("si_none");
        let argv = vec!["glyph".to_string(), "--verbose".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_when_path_does_not_exist() {
        let cwd = unique_tmp("si_missing");
        let argv = vec!["glyph".to_string(), "nope.md".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn second_instance_event_returns_none_for_non_file_non_dir_paths() {
        // A named pipe (FIFO) `.exists()` and canonicalises, but is_file/is_dir
        // both return false — exercises the fallthrough `return None` branch.
        let cwd = unique_tmp("si_fifo");
        let fifo = cwd.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo invocation should succeed on a unix runner");
        assert!(status.success(), "mkfifo should succeed on this runner");

        let argv = vec!["glyph".to_string(), "pipe".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_implements_debug_formatting() {
        // Covers the auto-derived `Debug` impl for the enum. Without an
        // explicit call site, the impl is only reached via the panic
        // messages in the matches! tests below, which never fire when
        // those tests pass.
        let actions = [
            InitialOpenAction::Folder("/workspace".to_string()),
            InitialOpenAction::File("/workspace/notes.md".to_string()),
            InitialOpenAction::RejectedUnsupported("/workspace/evil.txt".to_string()),
        ];
        for action in &actions {
            let formatted = format!("{action:?}");
            assert!(
                !formatted.is_empty(),
                "expected non-empty Debug for {action:?}"
            );
        }
    }

    #[test]
    fn classify_resolved_path_recognises_folders() {
        let cwd = unique_tmp("cls_folder");
        let result = classify_resolved_path(&cwd.canonicalize().unwrap()).expect("classifies");
        assert!(matches!(result, InitialOpenAction::Folder(_)));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_recognises_markdown_files() {
        let cwd = unique_tmp("cls_md");
        let file = cwd.join("note.md");
        fs::write(&file, "x").unwrap();
        let result = classify_resolved_path(&file.canonicalize().unwrap()).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::File(p) if p.ends_with("note.md")),
            "expected File ending in note.md, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_rejects_non_markdown_files() {
        let cwd = unique_tmp("cls_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>alert('x')</script>").unwrap();
        let result = classify_resolved_path(&file.canonicalize().unwrap()).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::RejectedUnsupported(p) if p.ends_with("evil.txt")),
            "expected RejectedUnsupported ending in evil.txt, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_resolved_path_returns_none_for_missing_paths() {
        let cwd = unique_tmp("cls_miss");
        let missing = cwd.join("not-here.md");
        // Don't actually create the file — passing the would-be path directly.
        assert!(classify_resolved_path(&missing).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn classify_resolved_path_returns_none_for_non_file_non_dir_paths() {
        // FIFO exists but is_file/is_dir both return false.
        let cwd = unique_tmp("cls_fifo");
        let fifo = cwd.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo invocation should succeed on a unix runner");
        assert!(status.success());
        let canonical = fifo.canonicalize().unwrap();
        assert!(classify_resolved_path(&canonical).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_resolves_then_classifies() {
        let cwd = unique_tmp("cia_md");
        let file = cwd.join("notes.md");
        fs::write(&file, "x").unwrap();
        let result = classify_initial_arg("notes.md", &cwd).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::File(p) if p.ends_with("notes.md")),
            "expected File ending in notes.md, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_rejects_non_markdown_extensions() {
        let cwd = unique_tmp("cia_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "x").unwrap();
        let result = classify_initial_arg("evil.txt", &cwd).expect("classifies");
        assert!(matches!(result, InitialOpenAction::RejectedUnsupported(_)));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn classify_initial_arg_returns_none_for_unresolvable_paths() {
        let cwd = unique_tmp("cia_missing");
        assert!(classify_initial_arg("does_not_exist.md", &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_returns_none_for_non_markdown_files() {
        // Covers the RejectedUnsupported -> None arm in second_instance_event:
        // a second instance pointed at evil.txt should not fire any event.
        let cwd = unique_tmp("si_txt");
        let file = cwd.join("evil.txt");
        fs::write(&file, "<script>").unwrap();
        let argv = vec!["glyph".to_string(), "evil.txt".to_string()];
        assert!(second_instance_event(&argv, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn second_instance_event_skips_program_name_and_flags() {
        let cwd = unique_tmp("si_flags");
        let file = cwd.join("readme.md");
        fs::write(&file, "x").unwrap();

        let argv = vec![
            "glyph".to_string(),
            "--quiet".to_string(),
            "-v".to_string(),
            "readme.md".to_string(),
        ];
        let result = second_instance_event(&argv, &cwd).expect("should resolve");
        assert_eq!(result.event_name, "open-file");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn pick_flag_value_finds_space_and_equals_forms() {
        let argv: Vec<String> = ["glyph", "docs", "--export", "site"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&argv, "--export"), Some("site"));

        let eq_form: Vec<String> = ["glyph", "--export=out", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&eq_form, "--export"), Some("out"));
    }

    #[test]
    fn pick_flag_value_returns_none_when_absent_or_valueless() {
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();
        assert_eq!(pick_flag_value(&argv, "--export"), None);
        let dangling: Vec<String> = ["glyph", "--export"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&dangling, "--export"), None);
    }

    #[test]
    fn strip_flag_removes_flag_and_value_leaving_positionals() {
        let argv: Vec<String> = ["glyph", "--export", "site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(strip_flag(&argv, "--export"), vec!["glyph", "docs"]);
        let eq_form: Vec<String> = ["glyph", "--export=site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(strip_flag(&eq_form, "--export"), vec!["glyph", "docs"]);
    }

    #[test]
    fn resolve_out_path_makes_relative_paths_absolute_without_requiring_existence() {
        let cwd = Path::new("/work");
        let resolved = resolve_out_path("site", cwd).expect("resolves");
        assert_eq!(resolved, Path::new("/work").join("site").to_string_lossy());
        assert!(resolve_out_path("  ", cwd).is_none());
    }

    #[test]
    fn resolve_out_path_keeps_absolute_paths_as_given() {
        // temp_dir is absolute on every platform (a bare "/x" is not absolute
        // on Windows, where absolute needs a drive or UNC prefix).
        let abs = std::env::temp_dir().join("glyph-site-out");
        let resolved = resolve_out_path(abs.to_string_lossy().as_ref(), Path::new("/elsewhere"))
            .expect("resolves");
        assert_eq!(resolved, abs.to_string_lossy());
    }

    fn argv_of(args: &[&str]) -> Vec<String> {
        std::iter::once("glyph")
            .chain(args.iter().copied())
            .map(String::from)
            .collect()
    }

    #[test]
    fn has_flag_spots_both_spellings_but_not_the_program_name() {
        assert!(has_flag(&argv_of(&["--export", "pdf"]), "--export"));
        assert!(has_flag(&argv_of(&["--export=pdf"]), "--export"));
        // Valueless still counts as present, which is what turns it into a
        // usage error rather than a silent normal launch.
        assert!(has_flag(&argv_of(&["--export"]), "--export"));
        assert!(!has_flag(&argv_of(&["notes.md"]), "--export"));
    }

    #[test]
    fn export_format_parses_every_spelling_and_rejects_junk() {
        for format in ExportFormat::ALL {
            assert_eq!(ExportFormat::parse(format.as_str()), Some(format));
        }
        assert_eq!(ExportFormat::parse("  PDF "), Some(ExportFormat::Pdf));
        assert_eq!(ExportFormat::parse("markdown"), None);
        assert_eq!(ExportFormat::parse(""), None);
        // Only `site` writes a directory, so only it has no default extension.
        assert_eq!(ExportFormat::Site.extension(), None);
        assert_eq!(ExportFormat::Pdf.extension(), Some("pdf"));
    }

    #[test]
    fn launch_plan_without_export_flag_is_a_normal_open() {
        let cwd = unique_tmp("lp_open");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();

        let plan = launch_plan(None, None, None, &argv_of(&["docs"]), &cwd).expect("plans");
        assert!(matches!(
            plan,
            CliLaunch::Open(Some(InitialOpenAction::Folder(_)))
        ));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_defaults_the_output_to_the_input_with_the_format_extension() {
        let cwd = unique_tmp("lp_doc");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        for (format, extension) in [
            ("pdf", "pdf"),
            ("docx", "docx"),
            ("epub", "epub"),
            ("html", "html"),
        ] {
            let argv = argv_of(&["note.md", "--export", format]);
            let plan = launch_plan(None, None, None, &argv, &cwd).expect("plans");
            let expected = format!("note.{extension}");
            assert!(
                matches!(&plan, CliLaunch::Export { input, format: parsed, output }
                    if parsed.as_str() == format
                        && input.ends_with("note.md")
                        && output.ends_with(&expected)),
                "expected note.md -> {expected}, got {plan:?}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn default_output_drops_the_windows_extended_length_prefix() {
        // Canonicalized inputs carry the extended-length prefix on Windows. It
        // works for the write but reads as noise in the path the export prints.
        let prefixed = format!(r"\\?\C:{sep}notes{sep}plan.md", sep = "\\");
        assert_eq!(
            default_output(&prefixed, ExportFormat::Pdf),
            format!(r"C:{sep}notes{sep}plan.pdf", sep = "\\")
        );
        assert_eq!(
            default_output("/notes/plan.md", ExportFormat::Epub),
            "/notes/plan.epub"
        );
        // A network path canonicalizes to the UNC spelling; dropping the
        // prefix naively would leave a relative path resolved against cwd.
        let unc = format!(r"\\?\UNC{sep}server{sep}share{sep}plan.md", sep = "\\");
        assert_eq!(
            default_output(&unc, ExportFormat::Html),
            format!(r"{sep}{sep}server{sep}share{sep}plan.html", sep = "\\")
        );
    }

    #[test]
    fn launch_plan_accepts_every_output_flag_spelling_and_resolves_it_against_cwd() {
        let cwd = unique_tmp("lp_out");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();
        let expected = cwd.join("built.pdf").to_string_lossy().to_string();

        for args in [
            vec!["note.md", "--export", "pdf", "-o", "built.pdf"],
            vec!["note.md", "--export", "pdf", "--out", "built.pdf"],
            vec!["note.md", "--export=pdf", "--out=built.pdf"],
            // The flags' values must never be mistaken for the positional path.
            vec!["--export", "pdf", "--out", "built.pdf", "note.md"],
        ] {
            let plan = launch_plan(None, None, None, &argv_of(&args), &cwd).expect("plans");
            assert!(
                matches!(&plan, CliLaunch::Export { output, .. } if *output == expected),
                "expected {expected}, got {plan:?}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    /// Unwrap a plan that is expected to be a serve, so the assertions below
    /// read as one line each.
    fn serve_of(argv: &[String], cwd: &Path) -> (String, std::net::IpAddr, u16, Option<String>) {
        match launch_plan(None, None, None, argv, cwd).expect("plans") {
            CliLaunch::Serve {
                root,
                host,
                port,
                output,
            } => (root, host, port, output),
            other => panic!("expected a serve plan, got {other:?}"),
        }
    }

    #[test]
    fn serve_defaults_to_loopback_a_fixed_port_and_a_temporary_directory() {
        let cwd = unique_tmp("serve_defaults");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        let (root, host, port, output) = serve_of(&argv_of(&["serve", "docs"]), &cwd);
        assert!(root.ends_with("docs"), "got {root}");
        assert_eq!(host, DEFAULT_SERVE_HOST);
        assert_eq!(port, DEFAULT_SERVE_PORT);
        assert!(host.is_loopback(), "the default must not face the network");
        assert_eq!(output, None, "no --out means a temporary directory");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_reads_host_port_and_out_in_both_flag_spellings() {
        let cwd = unique_tmp("serve_flags");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        for argv in [
            argv_of(&[
                "serve", "docs", "--host", "0.0.0.0", "--port", "8080", "--out", "build",
            ]),
            argv_of(&[
                "serve",
                "--host=0.0.0.0",
                "--port=8080",
                "--out=build",
                "docs",
            ]),
        ] {
            let (root, host, port, output) = serve_of(&argv, &cwd);
            assert!(root.ends_with("docs"), "got {root}");
            assert_eq!(host.to_string(), "0.0.0.0");
            assert_eq!(port, 8080);
            assert_eq!(
                output,
                Some(cwd.join("build").to_string_lossy().to_string())
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_does_not_mistake_a_flag_value_for_the_folder() {
        // `build` is the value of --out, not the folder to serve, and the
        // folder argument comes after it.
        let cwd = unique_tmp("serve_order");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        let argv = argv_of(&["serve", "--out", "build", "docs"]);
        let (root, _, _, output) = serve_of(&argv, &cwd);
        assert!(root.ends_with("docs"), "got {root}");
        assert_eq!(
            output,
            Some(cwd.join("build").to_string_lossy().to_string())
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_accepts_port_zero_for_an_os_assigned_port() {
        let cwd = unique_tmp("serve_port0");
        fs::create_dir_all(cwd.join("docs")).unwrap();
        let (_, _, port, _) = serve_of(&argv_of(&["serve", "docs", "--port", "0"]), &cwd);
        assert_eq!(port, 0);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_rejects_a_missing_a_nonexistent_and_a_file_target() {
        let cwd = unique_tmp("serve_bad_target");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "hi").unwrap();

        let missing = launch_plan(None, None, None, &argv_of(&["serve"]), &cwd).unwrap_err();
        assert!(missing.contains("needs a folder"), "got: {missing}");

        for target in ["nope", "note.md"] {
            let err =
                launch_plan(None, None, None, &argv_of(&["serve", target]), &cwd).unwrap_err();
            assert!(
                err.contains("requires an existing folder"),
                "{target} gave: {err}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_rejects_a_host_or_port_it_cannot_parse() {
        let cwd = unique_tmp("serve_bad_flags");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        let host = launch_plan(
            None,
            None,
            None,
            &argv_of(&["serve", "docs", "--host", "not-an-address"]),
            &cwd,
        )
        .unwrap_err();
        assert!(host.contains("not a valid address"), "got: {host}");

        for bad in ["99999", "-1", "http"] {
            let err = launch_plan(
                None,
                None,
                None,
                &argv_of(&["serve", "docs", "--port", bad]),
                &cwd,
            )
            .unwrap_err();
            assert!(err.contains("--port must be a number"), "{bad} gave: {err}");
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_refuses_to_write_its_output_inside_the_folder_it_watches() {
        // Exporting into the watched folder would feed the site back into the
        // next rebuild, the same trap the in-app website export guards.
        let cwd = unique_tmp("serve_nested_out");
        let docs = cwd.join("docs");
        fs::create_dir_all(&docs).unwrap();

        for out in ["docs/site", "docs"] {
            let err = launch_plan(
                None,
                None,
                None,
                &argv_of(&["serve", "docs", "--out", out]),
                &cwd,
            )
            .unwrap_err();
            assert!(
                err.contains("cannot be inside the folder being served"),
                "--out {out} gave: {err}"
            );
        }

        // A sibling directory is fine.
        let (_, _, _, output) = serve_of(&argv_of(&["serve", "docs", "--out", "site"]), &cwd);
        assert_eq!(output, Some(cwd.join("site").to_string_lossy().to_string()));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_refuses_an_output_directory_that_contains_the_served_folder() {
        // Everything in the output directory is published, so `--out .` when
        // serving ./docs would put the sources, and any .env or .git beside
        // them, on the server.
        let cwd = unique_tmp("serve_out_above");
        let docs = cwd.join("docs");
        fs::create_dir_all(&docs).unwrap();

        for out in [".", ".."] {
            let err = launch_plan(
                None,
                None,
                None,
                &argv_of(&["serve", "docs", "--out", out]),
                &cwd,
            )
            .unwrap_err();
            assert!(
                err.contains("cannot contain the folder being served"),
                "--out {out} gave: {err}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_rejects_a_flag_with_nothing_after_it() {
        // Silently binding the default would hide the typo, and `--export`
        // already treats a valueless flag as a usage error.
        let cwd = unique_tmp("serve_dangling");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        for flag in ["--host", "--port", "--out"] {
            let err = launch_plan(None, None, None, &argv_of(&["serve", "docs", flag]), &cwd)
                .unwrap_err();
            assert!(err.contains(&format!("{flag} needs a value")), "got: {err}");
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_folder_named_serve_still_opens_normally() {
        // `serve` is only a subcommand as a bare first argument, so the
        // documented `./serve` spelling keeps working as a path.
        let cwd = unique_tmp("serve_named_folder");
        fs::create_dir_all(cwd.join("serve")).unwrap();

        let plan = launch_plan(None, None, None, &argv_of(&["./serve"]), &cwd).expect("plans");
        assert!(
            matches!(&plan, CliLaunch::Open(Some(InitialOpenAction::Folder(p))) if p.ends_with("serve")),
            "expected a normal folder open, got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn only_launches_that_do_their_own_work_keep_the_running_instance_out_of_it() {
        // Opening a document should reuse the open window.
        assert!(forwards_to_running_instance(&argv_of(&["notes.md"])));
        assert!(forwards_to_running_instance(&argv_of(&[])));
        // An export and a serve do their work here; handing the arguments to
        // another process would exit 0 having done none of it.
        assert!(!forwards_to_running_instance(&argv_of(&[
            "notes.md", "--export", "pdf"
        ])));
        assert!(!forwards_to_running_instance(&argv_of(&["--export=site"])));
        assert!(!forwards_to_running_instance(&argv_of(&["serve", "docs"])));
        // A folder named `serve` is an ordinary open, and forwards.
        assert!(forwards_to_running_instance(&argv_of(&["./serve"])));
    }

    #[test]
    fn is_serve_invocation_only_matches_a_bare_first_argument() {
        assert!(is_serve_invocation(&argv_of(&["serve", "docs"])));
        assert!(!is_serve_invocation(&argv_of(&["./serve"])));
        assert!(!is_serve_invocation(&argv_of(&["docs", "serve"])));
        assert!(!is_serve_invocation(&argv_of(&[])));
    }

    #[test]
    fn launch_plan_pairs_a_folder_with_the_site_format() {
        let cwd = unique_tmp("lp_site");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv = argv_of(&["--export", "site", "--out", "site", "docs"]);

        let plan = launch_plan(None, None, None, &argv, &cwd).expect("plans");
        let expected_out = cwd.join("site").to_string_lossy().to_string();
        assert!(
            matches!(
                &plan,
                CliLaunch::Export { input, format, output }
                    if input.ends_with("docs")
                        && *format == ExportFormat::Site
                        && *output == expected_out
            ),
            "expected a site export for docs -> site, got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_a_missing_or_unknown_format() {
        let cwd = unique_tmp("lp_fmt");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        let dangling = argv_of(&["note.md", "--export"]);
        let err = launch_plan(None, None, None, &dangling, &cwd).expect_err("usage error");
        assert!(err.contains("needs a format"), "got: {err}");

        let unknown = argv_of(&["note.md", "--export", "rtf"]);
        let err = launch_plan(None, None, None, &unknown, &cwd).expect_err("usage error");
        assert!(err.contains("unknown export format"), "got: {err}");
        // Every accepted spelling is named, so the message is actionable.
        assert!(err.contains("pdf") && err.contains("site"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_a_mismatched_input_kind() {
        let cwd = unique_tmp("lp_kind");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        // A document format pointed at a folder.
        let err = launch_plan(
            None,
            None,
            None,
            &argv_of(&["docs", "--export", "pdf"]),
            &cwd,
        )
        .expect_err("usage error");
        assert!(err.contains("requires an existing document"), "got: {err}");

        // `site` pointed at a file.
        let argv = argv_of(&["note.md", "--export", "site", "-o", "out"]);
        let err = launch_plan(None, None, None, &argv, &cwd).expect_err("usage error");
        assert!(err.contains("workspace folder"), "got: {err}");

        // Nothing to export at all.
        let argv = argv_of(&["--export", "pdf"]);
        assert!(launch_plan(None, None, None, &argv, &cwd).is_err());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_an_input_that_is_not_one_document() {
        // A canvas renders each card in its own `.markdown-body`, so exporting
        // one would silently write the first card as the whole document.
        let cwd = unique_tmp("lp_canvas");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("board.canvas"), "{}").unwrap();
        fs::write(cwd.join("shape.d2"), "a -> b").unwrap();

        for input in ["board.canvas", "shape.d2"] {
            let err = launch_plan(
                None,
                None,
                None,
                &argv_of(&[input, "--export", "pdf"]),
                &cwd,
            )
            .expect_err("usage error");
            assert!(err.contains("markdown or notebook document"), "got: {err}");
        }

        // The same files still open normally.
        let plan = launch_plan(None, None, None, &argv_of(&["board.canvas"]), &cwd).expect("plans");
        assert!(matches!(
            plan,
            CliLaunch::Open(Some(InitialOpenAction::File(_)))
        ));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_an_output_path_with_no_export() {
        // `--out`'s value is stripped before the positional scan, so without
        // this the launch would open an empty window instead of the file.
        let cwd = unique_tmp("lp_out_only");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        for args in [
            vec!["note.md", "--out", "built.pdf"],
            vec!["note.md", "-o", "built.pdf"],
        ] {
            let err =
                launch_plan(None, None, None, &argv_of(&args), &cwd).expect_err("usage error");
            assert!(
                err.contains("--out only applies to an export"),
                "got: {err}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_requires_an_output_directory_for_a_site_export() {
        let cwd = unique_tmp("lp_site_out");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();

        let err = launch_plan(
            None,
            None,
            None,
            &argv_of(&["docs", "--export", "site"]),
            &cwd,
        )
        .expect_err("usage error");
        assert!(err.contains("output directory"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_a_blank_output_path() {
        let cwd = unique_tmp("lp_blank");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        let err = launch_plan(None, Some("pdf"), Some("   "), &argv_of(&["note.md"]), &cwd)
            .expect_err("usage error");
        assert!(err.contains("--out needs a path"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_prefers_the_plugin_values_over_argv() {
        let cwd = unique_tmp("lp_plugin");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();

        let plan = launch_plan(
            None,
            Some("site"),
            Some("from-plugin"),
            &argv_of(&["docs"]),
            &cwd,
        )
        .expect("plans");
        let expected_out = cwd.join("from-plugin").to_string_lossy().to_string();
        assert!(
            matches!(&plan, CliLaunch::Export { output, .. } if *output == expected_out),
            "expected the plugin's out dir, got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn empty_input_returns_none() {
        assert!(resolve_initial_path("", Path::new("/tmp")).is_none());
    }

    #[test]
    fn nonexistent_path_returns_none() {
        let cwd = unique_tmp("missing");
        let result = resolve_initial_path("does_not_exist.md", &cwd);
        assert!(result.is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn absolute_existing_file_is_canonicalized() {
        let cwd = unique_tmp("abs_file");
        let file = cwd.join("notes.md");
        fs::write(&file, "x").unwrap();

        let resolved = resolve_initial_path(file.to_string_lossy().as_ref(), Path::new("/"))
            .expect("should resolve");
        assert_eq!(
            resolved.canonicalize().unwrap(),
            file.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn relative_path_resolves_against_cwd() {
        let cwd = unique_tmp("rel_cwd");
        let file = cwd.join("readme.md");
        fs::write(&file, "x").unwrap();

        let resolved = resolve_initial_path("readme.md", &cwd).expect("should resolve");
        assert_eq!(resolved, file.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn relative_path_falls_back_to_parent_when_cwd_misses() {
        // Simulates `cargo tauri dev` running with cwd=src-tauri/ but the user
        // passed a path that lives in the repo root one level up.
        let root = unique_tmp("rel_parent_root");
        fs::write(root.join("notes.md"), "x").unwrap();
        let inner = root.join("src-tauri");
        fs::create_dir_all(&inner).unwrap();

        let resolved = resolve_initial_path("notes.md", &inner).expect("should resolve via parent");
        assert_eq!(resolved, root.join("notes.md").canonicalize().unwrap());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn initial_open_action_prefers_plugin_value_over_argv() {
        let cwd = unique_tmp("ioa_pref");
        let plugin_target = cwd.join("from-plugin");
        let argv_target = cwd.join("from-argv");
        fs::create_dir_all(&plugin_target).unwrap();
        fs::create_dir_all(&argv_target).unwrap();

        let env_args = vec!["glyph".to_string(), "from-argv".to_string()];
        let result = initial_open_action(Some("from-plugin"), &env_args, &cwd).expect("classifies");
        assert!(
            matches!(&result, InitialOpenAction::Folder(p) if p.ends_with("from-plugin")),
            "expected the plugin-supplied path to win, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_falls_back_to_argv_when_plugin_is_empty() {
        // This is the Windows path: tauri-plugin-cli's `file` arg is
        // None / null because pnpm's arg forwarding bypassed it, but the
        // positional arg is still in argv. The fallback must pick it up.
        let cwd = unique_tmp("ioa_fallback");
        let target = cwd.join("samples");
        fs::create_dir_all(&target).unwrap();

        let env_args = vec!["glyph".to_string(), "samples".to_string()];
        let result = initial_open_action(None, &env_args, &cwd).expect("classifies via argv");
        assert!(
            matches!(&result, InitialOpenAction::Folder(p) if p.ends_with("samples")),
            "expected argv fallback to find samples, got {result:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_returns_none_when_neither_source_yields_a_path() {
        let cwd = unique_tmp("ioa_none");
        let env_args = vec!["glyph".to_string(), "--verbose".to_string()];
        assert!(initial_open_action(None, &env_args, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn initial_open_action_returns_none_when_path_does_not_exist() {
        // Plugin and argv agree on a path, but it isn't there. Should be
        // None (and the caller decides whether to log).
        let cwd = unique_tmp("ioa_missing");
        let env_args = vec!["glyph".to_string(), "nope".to_string()];
        assert!(initial_open_action(Some("nope"), &env_args, &cwd).is_none());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn resolves_to_a_directory_path_too() {
        let cwd = unique_tmp("rel_dir");
        let sub = cwd.join("workspace");
        fs::create_dir_all(&sub).unwrap();

        let resolved = resolve_initial_path("workspace", &cwd).expect("should resolve");
        assert!(resolved.is_dir());
        assert_eq!(resolved, sub.canonicalize().unwrap());
        let _ = fs::remove_dir_all(&cwd);
    }
}
