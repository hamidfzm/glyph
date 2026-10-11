// The `#[cfg(desktop)]` items are the CLI launch-plan half; the ungated
// classifiers stay in use by the drag-drop and file-association handlers.

use std::path::{Path, PathBuf};

use crate::is_supported_file;
use crate::windows::{OpenKind, PendingOpen};

/// Every path argument of a launch, in the order given. `argv` is the full
/// argument list with the program name at index 0, as both the process itself
/// and `tauri-plugin-single-instance`'s callback provide it.
///
/// A launch names any number of paths: a file manager expands the desktop
/// entry's `%F` to every selected file (`glyph /a.md /b.md /c.md`). Anything
/// starting with `-` is a flag, up to a bare `--`; everything after that is a
/// path.
pub fn path_args(argv: &[String]) -> Vec<&str> {
    let mut paths = Vec::new();
    let mut flags_ended = false;
    for arg in argv.iter().skip(1) {
        if !flags_ended && arg == "--" {
            flags_ended = true;
            continue;
        }
        let is_flag = !flags_ended && arg.starts_with('-');
        if !arg.is_empty() && !is_flag {
            paths.push(arg.as_str());
        }
    }
    paths
}

/// What one launch path resolves to. Shared by every entry that turns a
/// user-supplied path into an "open this" intent: launch arguments (cold start
/// and second instance), macOS `RunEvent::Opened`, and the `export` and
/// `serve` subcommands, which each take exactly one. [`LaunchOpens`] collects
/// these for a launch that names several.
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
/// result. Used for every launch argument, on a cold start and from a second
/// instance: the user may pass a relative path, and classification needs to
/// happen against the canonicalized form so symlinks and `..` traversal are
/// normalised.
pub fn classify_initial_arg(path_str: &str, cwd: &Path) -> Option<InitialOpenAction> {
    let canonical = resolve_initial_path(path_str, cwd)?;
    classify_resolved_path(&canonical)
}

/// A launch path that will not be opened, and why. The caller reports each one
/// rather than dropping it, and none of them stops the paths after it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkippedPath {
    /// See [`InitialOpenAction::RejectedUnsupported`]. Inner is the absolute path.
    Unsupported(String),
    /// Resolves to neither a regular file nor a folder. Inner is the path as
    /// the launch named it.
    Missing(String),
}

impl std::fmt::Display for SkippedPath {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Unsupported(path) => write!(f, "Refusing to open unsupported file type: {path}"),
            Self::Missing(path) => write!(f, "Cannot open {path}: not a file or folder"),
        }
    }
}

/// What the paths of one launch resolve to: the opens to perform, in the order
/// given and without repeats, and the paths that were skipped.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct LaunchOpens {
    pub opens: Vec<PendingOpen>,
    pub skipped: Vec<SkippedPath>,
}

impl LaunchOpens {
    /// Record how one path classified. `given` is the path as the launch named
    /// it, for reporting one that did not resolve.
    fn push(&mut self, given: &str, action: Option<InitialOpenAction>) {
        let (kind, path) = match action {
            Some(InitialOpenAction::Folder(path)) => (OpenKind::Folder, path),
            Some(InitialOpenAction::File(path)) => (OpenKind::File, path),
            Some(InitialOpenAction::RejectedUnsupported(path)) => {
                self.skipped.push(SkippedPath::Unsupported(path));
                return;
            }
            None => {
                self.skipped.push(SkippedPath::Missing(given.to_string()));
                return;
            }
        };
        let open = PendingOpen { kind, path };
        if !self.opens.contains(&open) {
            self.opens.push(open);
        }
    }
}

/// Classify every path argument of a launch, each resolved against `cwd`.
/// Shared by a cold start and a launch forwarded to the running instance, so
/// both open the same set for the same arguments.
pub fn launch_opens(argv: &[String], cwd: &Path) -> LaunchOpens {
    let mut launch = LaunchOpens::default();
    for path in path_args(argv) {
        launch.push(path, classify_initial_arg(path, cwd));
    }
    launch
}

/// Classify the paths of a macOS `RunEvent::Opened`, which the OS has already
/// resolved, under the same rules as [`launch_opens`].
pub fn opened_paths(paths: &[PathBuf]) -> LaunchOpens {
    let mut launch = LaunchOpens::default();
    for path in paths {
        launch.push(&path.to_string_lossy(), classify_resolved_path(path));
    }
    launch
}

/// Value of a `--flag value` / `--flag=value` pair in argv, if present.
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
/// ([`path_args`]) can't mistake the flag's value for a path argument.
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
/// whether it carries a value. Distinguishes "no `--format`" from
/// "`--format` with nothing after it", which is a usage error.
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

/// What `glyph export --format` can produce. Every variant but `Site`
/// renders the single input document; `Site` renders a whole workspace folder.
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
    /// Normal interactive launch, opening every supported path it names.
    Open(LaunchOpens),
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

/// The subcommands, which are the only things that take flags.
#[cfg(desktop)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Subcommand {
    Export,
    Serve,
    Mcp,
}

/// Which subcommand argv asks for, if any.
///
/// Only a bare first argument counts, so a folder named `export`, `serve` or
/// `mcp` still opens normally as `glyph ./export`.
#[cfg(desktop)]
pub fn subcommand(env_args: &[String]) -> Option<Subcommand> {
    match env_args.get(1)?.as_str() {
        "export" => Some(Subcommand::Export),
        "serve" => Some(Subcommand::Serve),
        "mcp" => Some(Subcommand::Mcp),
        _ => None,
    }
}

/// The path a subcommand operates on: the first bare argument after the
/// subcommand itself. Flag values are stripped first so `glyph export --out
/// build docs` cannot mistake "build" for the path.
#[cfg(desktop)]
fn subcommand_path(env_args: &[String], value_flags: &[&str]) -> Option<String> {
    let stripped = value_flags
        .iter()
        .fold(env_args.to_vec(), |argv, flag| strip_flag(&argv, flag));
    // The first path argument is the subcommand word itself.
    path_args(&stripped).get(1).map(|path| path.to_string())
}

/// Whether this launch should hand its arguments to a Glyph the user already
/// has open, rather than doing the work itself.
///
/// Opening a document should reuse the running window. A subcommand must not:
/// each does its work in this process, and forwarding would exit 0 having done
/// none of it while the running app quietly opened a tab instead.
#[cfg(desktop)]
pub fn forwards_to_running_instance(env_args: &[String]) -> bool {
    subcommand(env_args).is_none()
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
    let path_arg = subcommand_path(env_args, &["--host", "--port", "--out", "-o"])
        .ok_or_else(|| format!("glyph serve needs a folder: {SERVE_USAGE}"))?;

    let root = match classify_initial_arg(&path_arg, cwd) {
        Some(InitialOpenAction::Folder(root)) => root,
        _ => {
            return Err(format!(
                "glyph serve requires an existing folder, not {}: {SERVE_USAGE}",
                plain_path(&path_arg)
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

/// The `export` usage line, and the site-specific spelling of it.
#[cfg(desktop)]
const EXPORT_USAGE: &str = "glyph export <path> --format <format> [--out <path>]";

#[cfg(desktop)]
const EXPORT_SITE_USAGE: &str = "glyph export <folder> --format site --out <dir>";

/// The `mcp` usage line, repeated by every one of its error messages.
#[cfg(desktop)]
const MCP_USAGE: &str = "glyph mcp [--vault <folder>]...";

/// What a launch that is no subcommand can look like.
#[cfg(desktop)]
const USAGE_SUMMARY: &str =
    "glyph [<path>...] | glyph export ... | glyph serve ... | glyph mcp ...";

/// Decide what this launch should do from argv, the one source for it: an OS
/// file-association launch, a terminal, and `pnpm tauri dev -- samples` all
/// arrive there.
///
/// `Err` is a usage error the caller should print before exiting nonzero.
#[cfg(desktop)]
pub fn launch_plan(env_args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    match subcommand(env_args) {
        Some(Subcommand::Export) => export_plan(env_args, cwd),
        Some(Subcommand::Serve) => serve_plan(env_args, cwd),
        // `run()` serves this one before any app is built, so it only lands
        // here if that ever stops being true.
        Some(Subcommand::Mcp) => Err(format!(
            "glyph mcp cannot start inside the app: {MCP_USAGE}"
        )),
        None => open_plan(env_args, cwd),
    }
}

/// Parse `glyph mcp [--vault <folder>]...` into the vault roots, each an
/// existing folder. No roots means the vaults open in the app. `Err` is a
/// usage message the caller prints before exiting nonzero.
#[cfg(desktop)]
pub fn mcp_plan(env_args: &[String], cwd: &Path) -> Result<Vec<String>, String> {
    let mut vaults = Vec::new();
    let mut args = env_args.iter().skip(2);
    while let Some(arg) = args.next() {
        let value = match arg.strip_prefix("--vault=") {
            Some(value) => value,
            None if arg == "--vault" => args
                .next()
                .map(String::as_str)
                .ok_or_else(|| format!("--vault needs a value: {MCP_USAGE}"))?,
            None => {
                return Err(format!(
                    "glyph mcp takes only --vault, not '{arg}': {MCP_USAGE}"
                ))
            }
        };
        // Only the folder named: the parent-directory fallback that lets
        // `cargo tauri dev` run from src-tauri/ would grant a folder the flag
        // never pointed at.
        let named = cwd.join(value);
        let folder = (!value.trim().is_empty() && named.is_dir())
            .then(|| named.canonicalize().ok())
            .flatten();
        let Some(folder) = folder else {
            return Err(format!(
                "--vault needs an existing folder, not {}: {MCP_USAGE}",
                plain_path(value)
            ));
        };
        let root = plain_path(&folder.to_string_lossy());
        if !vaults.contains(&root) {
            vaults.push(root);
        }
    }
    Ok(vaults)
}

/// An ordinary launch: open every path it was given.
#[cfg(desktop)]
fn open_plan(env_args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    // After a bare `--` everything is a path, even one spelled like a flag.
    let flags_end = env_args
        .iter()
        .position(|arg| arg == "--")
        .unwrap_or(env_args.len());
    let flags = &env_args[..flags_end];
    // `--export <format>` was the old spelling of the export subcommand. It
    // is gone rather than deprecated, so say what replaced it: the flag is
    // sitting in people's CI scripts, and "unknown flag" would not help them.
    if has_flag(flags, "--export") {
        return Err(format!(
            "--export was replaced by a subcommand: {EXPORT_USAGE}"
        ));
    }
    // Any other flag here is a half-remembered subcommand, not an option this
    // shape takes, and silently opening an empty window would hide the typo.
    for flag in ["--format", "--out", "-o", "--host", "--port", "--vault"] {
        if has_flag(flags, flag) {
            return Err(format!("{flag} belongs to a subcommand: {USAGE_SUMMARY}"));
        }
    }
    Ok(CliLaunch::Open(launch_opens(env_args, cwd)))
}

/// Parse `glyph export <path> --format <format> [--out <path>]`.
#[cfg(desktop)]
fn export_plan(env_args: &[String], cwd: &Path) -> Result<CliLaunch, String> {
    let input = subcommand_path(env_args, &["--format", "--out", "-o"])
        .ok_or_else(|| format!("glyph export needs a path: {EXPORT_USAGE}"))?;

    for flag in ["--format", "--out", "-o"] {
        if has_flag(env_args, flag) && pick_flag_value(env_args, flag).is_none() {
            return Err(format!("{flag} needs a value: {EXPORT_USAGE}"));
        }
    }
    let value = pick_flag_value(env_args, "--format")
        .ok_or_else(|| format!("glyph export needs --format: {}", format_list()))?;
    let format = ExportFormat::parse(value)
        .ok_or_else(|| format!("unknown export format '{value}': {}", format_list()))?;

    let out_value = pick_flag_value(env_args, "--out").or_else(|| pick_flag_value(env_args, "-o"));
    let output = out_value
        .map(|out| resolve_out_path(out, cwd).ok_or_else(|| "--out needs a path".to_string()))
        .transpose()?;

    match (format, classify_initial_arg(&input, cwd)) {
        (ExportFormat::Site, Some(InitialOpenAction::Folder(root))) => {
            let output = output.ok_or_else(|| {
                format!("the site format needs an output directory: {EXPORT_SITE_USAGE}")
            })?;
            Ok(CliLaunch::Export {
                input: root,
                format,
                output,
            })
        }
        (ExportFormat::Site, _) => Err(format!(
            "the site format needs an existing folder, not {}: {EXPORT_SITE_USAGE}",
            plain_path(&input)
        )),
        (_, Some(InitialOpenAction::File(input))) => {
            // A canvas board and a D2 file are "supported documents" for
            // opening, but neither renders as one document body: a canvas
            // has only its cards, so the export would find nothing to write.
            if !is_exportable_document(Path::new(&input)) {
                return Err(format!(
                    "the {} format only takes a markdown or notebook document, not {}",
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
            "the {} format needs an existing document, not {}: {EXPORT_USAGE}",
            format.as_str(),
            plain_path(&input)
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
/// files open fine but do not render as a single document body (a canvas
/// renders only its cards), so there is no document for the export to write.
#[cfg(desktop)]
fn is_exportable_document(path: &Path) -> bool {
    crate::is_markdown_file(path) || crate::is_notebook_file(path)
}

/// Output path for an export with no `--out`: the input with the format's
/// extension, so `glyph export notes.md --format pdf` writes `notes.pdf`
/// beside it.
#[cfg(desktop)]
pub(crate) fn default_output(input: &str, format: ExportFormat) -> String {
    let extension = format.extension().unwrap_or_default();
    Path::new(&plain_path(input))
        .with_extension(extension)
        .to_string_lossy()
        .to_string()
}

/// The accepted `--format` values, for usage messages and `--help`.
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

    /// Each open as (kind, file name), so assertions do not depend on how the
    /// platform spells a canonical path.
    fn opened(launch: &LaunchOpens) -> Vec<(OpenKind, String)> {
        launch
            .opens
            .iter()
            .map(|open| {
                let name = Path::new(&open.path).file_name().unwrap();
                (open.kind, name.to_string_lossy().to_string())
            })
            .collect()
    }

    fn file_named(name: &str) -> (OpenKind, String) {
        (OpenKind::File, name.to_string())
    }

    fn folder_named(name: &str) -> (OpenKind, String) {
        (OpenKind::Folder, name.to_string())
    }

    /// The opens of a plain launch, or `None` for a subcommand's plan.
    fn open_plan_of(plan: &CliLaunch) -> Option<Vec<(OpenKind, String)>> {
        match plan {
            CliLaunch::Open(launch) => Some(opened(launch)),
            _ => None,
        }
    }

    #[test]
    fn path_args_skips_the_program_name_flags_and_empty_strings() {
        assert_eq!(path_args(&argv_of(&["notes.md"])), vec!["notes.md"]);
        assert_eq!(
            path_args(&argv_of(&["--verbose", "-q", "", "real.md"])),
            vec!["real.md"]
        );
        assert!(path_args(&argv_of(&[])).is_empty());
        assert!(path_args(&argv_of(&["--help"])).is_empty());
        // The program name is never a path, even when it is all there is.
        assert!(path_args(&["notes.md".to_string()]).is_empty());
    }

    #[test]
    fn path_args_returns_every_path_in_the_order_given() {
        // What a file manager sends for `Exec=glyph %F` with three files selected.
        assert_eq!(
            path_args(&argv_of(&["/a.md", "/b.md", "/c.md"])),
            vec!["/a.md", "/b.md", "/c.md"]
        );
        // A flag between two paths does not end the scan.
        assert_eq!(
            path_args(&argv_of(&["a.md", "--quiet", "b.md"])),
            vec!["a.md", "b.md"]
        );
    }

    #[test]
    fn path_args_takes_everything_after_a_bare_double_dash_as_a_path() {
        assert_eq!(
            path_args(&argv_of(&["--", "-draft.md", "--notes.md"])),
            vec!["-draft.md", "--notes.md"]
        );
        // Only the first one separates; a later one is a path like any other.
        assert_eq!(
            path_args(&argv_of(&["a.md", "--", "--"])),
            vec!["a.md", "--"]
        );
    }

    #[test]
    fn launch_opens_classifies_a_file_and_a_folder() {
        let cwd = unique_tmp("lo_kinds");
        fs::write(cwd.join("note.md"), "x").unwrap();
        fs::create_dir_all(cwd.join("workspace")).unwrap();

        let launch = launch_opens(&argv_of(&["note.md"]), &cwd);
        assert_eq!(opened(&launch), vec![file_named("note.md")]);
        // The open carries the canonical absolute path, not the argument.
        assert_eq!(
            PathBuf::from(&launch.opens[0].path),
            cwd.join("note.md").canonicalize().unwrap()
        );
        assert!(launch.skipped.is_empty());

        let launch = launch_opens(&argv_of(&["workspace"]), &cwd);
        assert_eq!(opened(&launch), vec![folder_named("workspace")]);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_keeps_every_supported_path_in_the_order_given() {
        let cwd = unique_tmp("lo_many");
        for name in ["a.md", "b.md", "c.md"] {
            fs::write(cwd.join(name), "x").unwrap();
        }

        let launch = launch_opens(&argv_of(&["c.md", "--quiet", "a.md", "b.md"]), &cwd);
        assert_eq!(
            opened(&launch),
            vec![file_named("c.md"), file_named("a.md"), file_named("b.md")]
        );
        assert!(launch.skipped.is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_skips_an_unsupported_first_path_and_opens_the_rest() {
        // A mixed selection dropped on the launcher, or `glyph *` in a terminal.
        // The first path being refused must not sink the launch.
        let cwd = unique_tmp("lo_mixed");
        fs::write(cwd.join("notes.txt"), "<script>").unwrap();
        fs::write(cwd.join("a.md"), "x").unwrap();
        fs::write(cwd.join("b.md"), "x").unwrap();

        let launch = launch_opens(&argv_of(&["notes.txt", "a.md", "b.md"]), &cwd);
        assert_eq!(
            opened(&launch),
            vec![file_named("a.md"), file_named("b.md")]
        );
        assert!(
            matches!(launch.skipped.as_slice(), [SkippedPath::Unsupported(p)] if p.ends_with("notes.txt")),
            "got {:?}",
            launch.skipped
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_reports_a_missing_path_without_stopping() {
        let cwd = unique_tmp("lo_missing");
        fs::write(cwd.join("a.md"), "x").unwrap();
        fs::write(cwd.join("b.md"), "x").unwrap();

        let launch = launch_opens(&argv_of(&["a.md", "nope.md", "b.md"]), &cwd);
        assert_eq!(
            opened(&launch),
            vec![file_named("a.md"), file_named("b.md")]
        );
        assert_eq!(
            launch.skipped,
            vec![SkippedPath::Missing("nope.md".to_string())]
        );

        // A launch naming nothing that exists opens nothing and says so.
        let launch = launch_opens(&argv_of(&["nope.md"]), &cwd);
        assert!(launch.opens.is_empty());
        assert_eq!(launch.skipped.len(), 1);
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_opens_a_repeated_path_once() {
        // Relative, dotted and absolute spellings canonicalize to one path.
        let cwd = unique_tmp("lo_dupes");
        let note = cwd.join("note.md");
        fs::write(&note, "x").unwrap();
        fs::write(cwd.join("other.md"), "x").unwrap();

        let absolute = note.to_string_lossy();
        let argv = argv_of(&["note.md", "./note.md", "other.md", &*absolute, "note.md"]);
        let launch = launch_opens(&argv, &cwd);
        assert_eq!(
            opened(&launch),
            vec![file_named("note.md"), file_named("other.md")]
        );
        assert!(launch.skipped.is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_keeps_a_folder_among_files_in_position() {
        let cwd = unique_tmp("lo_folder");
        fs::write(cwd.join("a.md"), "x").unwrap();
        fs::write(cwd.join("b.md"), "x").unwrap();
        fs::create_dir_all(cwd.join("workspace")).unwrap();

        let launch = launch_opens(&argv_of(&["a.md", "workspace", "b.md"]), &cwd);
        assert_eq!(
            opened(&launch),
            vec![
                file_named("a.md"),
                folder_named("workspace"),
                file_named("b.md")
            ]
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_opens_is_empty_without_path_arguments() {
        let cwd = unique_tmp("lo_none");
        assert_eq!(
            launch_opens(&argv_of(&["--verbose"]), &cwd),
            LaunchOpens::default()
        );
        assert_eq!(launch_opens(&argv_of(&[]), &cwd), LaunchOpens::default());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[cfg(unix)]
    #[test]
    fn launch_opens_reports_a_path_that_is_neither_file_nor_folder() {
        // A named pipe (FIFO) `.exists()` and canonicalises, but is_file/is_dir
        // both return false.
        let cwd = unique_tmp("lo_fifo");
        let fifo = cwd.join("pipe");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo invocation should succeed on a unix runner");
        assert!(status.success(), "mkfifo should succeed on this runner");

        let launch = launch_opens(&argv_of(&["pipe"]), &cwd);
        assert!(launch.opens.is_empty());
        assert_eq!(
            launch.skipped,
            vec![SkippedPath::Missing("pipe".to_string())]
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn opened_paths_follows_the_same_rules_for_resolved_paths() {
        // macOS hands every selected document to one `Opened` event.
        let cwd = unique_tmp("op_many");
        fs::write(cwd.join("evil.txt"), "<script>").unwrap();
        fs::write(cwd.join("a.md"), "x").unwrap();
        fs::create_dir_all(cwd.join("workspace")).unwrap();

        let launch = opened_paths(&[
            cwd.join("evil.txt"),
            cwd.join("a.md"),
            cwd.join("a.md"),
            cwd.join("gone.md"),
            cwd.join("workspace"),
        ]);
        assert_eq!(
            opened(&launch),
            vec![file_named("a.md"), folder_named("workspace")]
        );
        assert!(
            matches!(
                launch.skipped.as_slice(),
                [SkippedPath::Unsupported(txt), SkippedPath::Missing(gone)]
                    if txt.ends_with("evil.txt") && gone.ends_with("gone.md")
            ),
            "got {:?}",
            launch.skipped
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_skipped_path_says_why_it_was_skipped() {
        let unsupported = SkippedPath::Unsupported("/notes/evil.txt".to_string());
        assert_eq!(
            unsupported.to_string(),
            "Refusing to open unsupported file type: /notes/evil.txt"
        );
        let missing = SkippedPath::Missing("nope.md".to_string());
        assert_eq!(
            missing.to_string(),
            "Cannot open nope.md: not a file or folder"
        );
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
    fn pick_flag_value_finds_space_and_equals_forms() {
        let argv: Vec<String> = ["glyph", "docs", "--format", "site"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&argv, "--format"), Some("site"));

        let eq_form: Vec<String> = ["glyph", "--format=out", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&eq_form, "--format"), Some("out"));
    }

    #[test]
    fn pick_flag_value_returns_none_when_absent_or_valueless() {
        let argv: Vec<String> = ["glyph", "docs"].iter().map(|s| s.to_string()).collect();
        assert_eq!(pick_flag_value(&argv, "--format"), None);
        let dangling: Vec<String> = ["glyph", "--format"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(pick_flag_value(&dangling, "--format"), None);
    }

    #[test]
    fn strip_flag_removes_flag_and_value_leaving_positionals() {
        let argv: Vec<String> = ["glyph", "--format", "site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(strip_flag(&argv, "--format"), vec!["glyph", "docs"]);
        let eq_form: Vec<String> = ["glyph", "--format=site", "docs"]
            .iter()
            .map(|s| s.to_string())
            .collect();
        assert_eq!(strip_flag(&eq_form, "--format"), vec!["glyph", "docs"]);
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
        assert!(has_flag(&argv_of(&["--format", "pdf"]), "--format"));
        assert!(has_flag(&argv_of(&["--format=pdf"]), "--format"));
        // Valueless still counts as present, which is what turns it into a
        // usage error rather than a silent normal launch.
        assert!(has_flag(&argv_of(&["--format"]), "--format"));
        assert!(!has_flag(&argv_of(&["notes.md"]), "--format"));
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

        let plan = launch_plan(&argv_of(&["docs"]), &cwd).expect("plans");
        assert_eq!(open_plan_of(&plan), Some(vec![folder_named("docs")]));

        // No path at all is still a normal launch, with nothing to open.
        let bare = launch_plan(&argv_of(&[]), &cwd).expect("plans");
        assert_eq!(open_plan_of(&bare), Some(Vec::new()));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_path_after_a_double_dash_is_never_read_as_a_flag() {
        let cwd = unique_tmp("lp_dashes");
        fs::write(cwd.join("-o.md"), "x").unwrap();

        // Without the separator, `--out` is a half-remembered subcommand flag.
        assert!(launch_plan(&argv_of(&["-o.md", "--out"]), &cwd).is_err());

        let plan = launch_plan(&argv_of(&["--", "-o.md", "--out"]), &cwd).expect("plans");
        assert_eq!(open_plan_of(&plan), Some(vec![file_named("-o.md")]));
        assert!(
            matches!(&plan, CliLaunch::Open(launch)
                if launch.skipped == [SkippedPath::Missing("--out".to_string())]),
            "got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_opens_every_path_a_plain_launch_names() {
        let cwd = unique_tmp("lp_many");
        fs::write(cwd.join("a.md"), "x").unwrap();
        fs::write(cwd.join("b.md"), "x").unwrap();
        fs::write(cwd.join("notes.txt"), "x").unwrap();

        let plan = launch_plan(&argv_of(&["notes.txt", "a.md", "b.md"]), &cwd).expect("plans");
        assert_eq!(
            open_plan_of(&plan),
            Some(vec![file_named("a.md"), file_named("b.md")])
        );
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
            let argv = argv_of(&["export", "note.md", "--format", format]);
            let plan = launch_plan(&argv, &cwd).expect("plans");
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
            vec!["export", "note.md", "--format", "pdf", "-o", "built.pdf"],
            vec!["export", "note.md", "--format", "pdf", "--out", "built.pdf"],
            vec!["export", "note.md", "--format=pdf", "--out=built.pdf"],
            // The flags' values must never be mistaken for the path.
            vec!["export", "--format", "pdf", "--out", "built.pdf", "note.md"],
        ] {
            let plan = launch_plan(&argv_of(&args), &cwd).expect("plans");
            assert!(
                matches!(&plan, CliLaunch::Export { output, .. } if *output == expected),
                "expected {expected}, got {plan:?}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    /// The fields of a serve plan, or `None` for any other kind of launch.
    /// Doubles as the discriminator the "folder named serve" test uses.
    fn serve_fields(plan: CliLaunch) -> Option<(String, std::net::IpAddr, u16, Option<String>)> {
        match plan {
            CliLaunch::Serve {
                root,
                host,
                port,
                output,
            } => Some((root, host, port, output)),
            _ => None,
        }
    }

    /// Plan a serve, so the assertions below read as one line each.
    fn serve_of(argv: &[String], cwd: &Path) -> (String, std::net::IpAddr, u16, Option<String>) {
        let plan = launch_plan(argv, cwd).expect("plans");
        serve_fields(plan).expect("expected a serve plan")
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

        let missing = launch_plan(&argv_of(&["serve"]), &cwd).unwrap_err();
        assert!(missing.contains("needs a folder"), "got: {missing}");

        for target in ["nope", "note.md"] {
            let err = launch_plan(&argv_of(&["serve", target]), &cwd).unwrap_err();
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
            &argv_of(&["serve", "docs", "--host", "not-an-address"]),
            &cwd,
        )
        .unwrap_err();
        assert!(host.contains("not a valid address"), "got: {host}");

        for bad in ["99999", "-1", "http"] {
            let err = launch_plan(&argv_of(&["serve", "docs", "--port", bad]), &cwd).unwrap_err();
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
            let err = launch_plan(&argv_of(&["serve", "docs", "--out", out]), &cwd).unwrap_err();
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
            let err = launch_plan(&argv_of(&["serve", "docs", "--out", out]), &cwd).unwrap_err();
            assert!(
                err.contains("cannot contain the folder being served"),
                "--out {out} gave: {err}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn serve_rejects_a_flag_with_nothing_after_it() {
        // Silently binding the default would hide the typo, and `export`
        // treats a valueless flag the same way.
        let cwd = unique_tmp("serve_dangling");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        for flag in ["--host", "--port", "--out"] {
            let err = launch_plan(&argv_of(&["serve", "docs", flag]), &cwd).unwrap_err();
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

        let plan = launch_plan(&argv_of(&["./serve"]), &cwd).expect("plans");
        assert_eq!(
            open_plan_of(&plan),
            Some(vec![folder_named("serve")]),
            "expected a normal folder open, got {plan:?}"
        );
        assert!(serve_fields(plan).is_none(), "it must not plan a serve");

        // The bare word is still the subcommand, and that plan opens nothing.
        let bare = launch_plan(&argv_of(&["serve", "./serve"]), &cwd).expect("plans");
        assert_eq!(open_plan_of(&bare), None, "got {bare:?}");
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
            "export", "notes.md", "--format", "pdf"
        ])));
        assert!(!forwards_to_running_instance(&argv_of(&["serve", "docs"])));
        // A folder named after a subcommand is an ordinary open, and forwards.
        assert!(forwards_to_running_instance(&argv_of(&["./serve"])));
        assert!(forwards_to_running_instance(&argv_of(&["./export"])));
    }

    #[test]
    fn a_candidate_with_no_resolvable_ancestor_is_outside() {
        // `--out` may name a directory that does not exist yet, so the walk
        // climbs to the deepest ancestor that does. A path with none at all
        // (a bare relative name against a root it shares nothing with) has to
        // end the walk rather than loop.
        let cwd = unique_tmp("outside_walk");
        fs::create_dir_all(&cwd).unwrap();
        assert!(!is_path_inside(Path::new("no-such-relative/deeper"), &cwd));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_root_that_cannot_be_resolved_contains_nothing() {
        // Guards the containment checks: an unresolvable root must not be
        // reported as containing (or contained by) anything.
        let missing = std::env::temp_dir().join("glyph-serve-no-such-root");
        let _ = fs::remove_dir_all(&missing);
        assert!(!is_path_inside(Path::new("/anywhere"), &missing));
    }

    #[test]
    fn export_needs_a_path_and_says_so() {
        let cwd = unique_tmp("export_no_path");
        fs::create_dir_all(&cwd).unwrap();
        let err =
            launch_plan(&argv_of(&["export", "--format", "pdf"]), &cwd).expect_err("usage error");
        assert!(err.contains("glyph export needs a path"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn export_does_not_mistake_a_flag_value_for_the_path() {
        // `built.pdf` is --out's value; the path comes after it.
        let cwd = unique_tmp("export_order");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        let argv = argv_of(&["export", "--out", "built.pdf", "--format", "pdf", "note.md"]);
        let plan = launch_plan(&argv, &cwd).expect("plans");
        let expected = cwd.join("built.pdf").to_string_lossy().to_string();
        assert!(
            matches!(&plan, CliLaunch::Export { input, output, .. }
                if input.ends_with("note.md") && *output == expected),
            "got {plan:?}"
        );
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn the_old_export_flag_says_what_replaced_it() {
        // It is in people's CI scripts; "unknown flag" would not help them.
        let cwd = unique_tmp("old_flag");
        fs::create_dir_all(cwd.join("docs")).unwrap();

        let err = launch_plan(
            &argv_of(&["docs", "--export", "site", "--out", "out"]),
            &cwd,
        )
        .expect_err("usage error");
        assert!(err.contains("--export was replaced"), "got: {err}");
        assert!(err.contains("glyph export"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_flag_without_a_subcommand_is_a_usage_error() {
        // Otherwise `glyph notes.md --format pdf` would open the file and
        // silently ignore the half-remembered command.
        let cwd = unique_tmp("bare_flag");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        for flag in ["--format", "--out", "-o", "--host", "--port", "--vault"] {
            let err =
                launch_plan(&argv_of(&["note.md", flag, "x"]), &cwd).expect_err("usage error");
            assert!(
                err.contains("belongs to a subcommand"),
                "{flag} gave: {err}"
            );
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_subcommand_is_only_a_bare_first_argument() {
        assert_eq!(
            subcommand(&argv_of(&["serve", "docs"])),
            Some(Subcommand::Serve)
        );
        assert_eq!(
            subcommand(&argv_of(&["export", "notes.md"])),
            Some(Subcommand::Export)
        );
        // A folder named after a subcommand still opens, as `./serve` does.
        assert_eq!(subcommand(&argv_of(&["./serve"])), None);
        assert_eq!(subcommand(&argv_of(&["./export"])), None);
        // Only the first argument counts.
        assert_eq!(subcommand(&argv_of(&["docs", "serve"])), None);
        assert_eq!(subcommand(&argv_of(&[])), None);
    }

    #[test]
    fn mcp_collects_every_vault_in_both_spellings() {
        let cwd = unique_tmp("mcp_vaults");
        fs::create_dir_all(cwd.join("a")).unwrap();
        fs::create_dir_all(cwd.join("b")).unwrap();

        let argv = argv_of(&["mcp", "--vault", "a", "--vault=b", "--vault", "a"]);
        let vaults = mcp_plan(&argv, &cwd).expect("plans");
        assert_eq!(
            vaults.len(),
            2,
            "a repeated folder is one vault: {vaults:?}"
        );
        assert!(vaults[0].ends_with('a') && vaults[1].ends_with('b'));
        // The extended-length prefix never reaches the paths an agent sees.
        assert!(vaults.iter().all(|vault| !vault.starts_with(r"\\?\")));
        // No --vault means the vaults open in the app.
        assert!(mcp_plan(&argv_of(&["mcp"]), &cwd).unwrap().is_empty());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn mcp_does_not_look_for_a_vault_in_the_parent_directory() {
        let parent = unique_tmp("mcp_parent");
        let cwd = parent.join("proj");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(parent.join("notes")).unwrap();
        let err = mcp_plan(&argv_of(&["mcp", "--vault", "notes"]), &cwd).expect_err("usage error");
        assert!(err.contains("needs an existing folder"), "{err}");
        let _ = fs::remove_dir_all(&parent);
    }

    #[test]
    fn mcp_refuses_anything_but_existing_folders() {
        let cwd = unique_tmp("mcp_bad");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        for (args, expected) in [
            (
                vec!["mcp", "--vault", "note.md"],
                "needs an existing folder",
            ),
            (
                vec!["mcp", "--vault", "missing"],
                "needs an existing folder",
            ),
            (vec!["mcp", "--vault="], "needs an existing folder"),
            (vec!["mcp", "--vault"], "--vault needs a value"),
            (vec!["mcp", "notes"], "takes only --vault"),
            (vec!["mcp", "--port", "1"], "takes only --vault"),
        ] {
            let err = mcp_plan(&argv_of(&args), &cwd).expect_err("usage error");
            assert!(err.contains(expected), "{args:?} gave: {err}");
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn a_folder_named_mcp_still_opens_and_mcp_itself_never_forwards() {
        let cwd = unique_tmp("mcp_named_folder");
        fs::create_dir_all(cwd.join("mcp")).unwrap();

        let plan = launch_plan(&argv_of(&["./mcp"]), &cwd).expect("plans");
        assert_eq!(
            open_plan_of(&plan),
            Some(vec![folder_named("mcp")]),
            "expected a normal folder open, got {plan:?}"
        );
        assert_eq!(subcommand(&argv_of(&["mcp"])), Some(Subcommand::Mcp));
        assert!(!forwards_to_running_instance(&argv_of(&["mcp"])));
        assert!(forwards_to_running_instance(&argv_of(&["./mcp"])));
        // Asked of the app's own planner, it is refused, never opened.
        assert!(launch_plan(&argv_of(&["mcp"]), &cwd).is_err());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_pairs_a_folder_with_the_site_format() {
        let cwd = unique_tmp("lp_site");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();
        let argv = argv_of(&["export", "docs", "--format", "site", "--out", "site"]);

        let plan = launch_plan(&argv, &cwd).expect("plans");
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

        let missing = argv_of(&["export", "note.md"]);
        let err = launch_plan(&missing, &cwd).expect_err("usage error");
        assert!(err.contains("needs --format"), "got: {err}");

        let dangling = argv_of(&["export", "note.md", "--format"]);
        let err = launch_plan(&dangling, &cwd).expect_err("usage error");
        assert!(err.contains("--format needs a value"), "got: {err}");

        let unknown = argv_of(&["export", "note.md", "--format", "rtf"]);
        let err = launch_plan(&unknown, &cwd).expect_err("usage error");
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
        let err = launch_plan(&argv_of(&["export", "docs", "--format", "pdf"]), &cwd)
            .expect_err("usage error");
        assert!(err.contains("needs an existing document"), "got: {err}");

        // `site` pointed at a file.
        let argv = argv_of(&["export", "note.md", "--format", "site", "-o", "out"]);
        let err = launch_plan(&argv, &cwd).expect_err("usage error");
        assert!(err.contains("needs an existing folder"), "got: {err}");

        // Nothing to export at all.
        let argv = argv_of(&["export", "--format", "pdf"]);
        assert!(launch_plan(&argv, &cwd).is_err());
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_an_input_that_is_not_one_document() {
        // A canvas renders each card in its own `.markdown-body` and no
        // document body, so a document export has nothing to write.
        let cwd = unique_tmp("lp_canvas");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("board.canvas"), "{}").unwrap();
        fs::write(cwd.join("shape.d2"), "a -> b").unwrap();

        for input in ["board.canvas", "shape.d2"] {
            let err = launch_plan(&argv_of(&["export", input, "--format", "pdf"]), &cwd)
                .expect_err("usage error");
            assert!(err.contains("markdown or notebook document"), "got: {err}");
        }

        // The same files still open normally.
        let plan = launch_plan(&argv_of(&["board.canvas"]), &cwd).expect("plans");
        assert_eq!(open_plan_of(&plan), Some(vec![file_named("board.canvas")]));
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_an_output_path_with_no_export() {
        // Without this the flag's value would be read as the path to open,
        // hiding the fact that the subcommand was left out.
        let cwd = unique_tmp("lp_out_only");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        for args in [
            vec!["note.md", "--out", "built.pdf"],
            vec!["note.md", "-o", "built.pdf"],
        ] {
            let err = launch_plan(&argv_of(&args), &cwd).expect_err("usage error");
            assert!(err.contains("belongs to a subcommand"), "got: {err}");
        }
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_requires_an_output_directory_for_a_site_export() {
        let cwd = unique_tmp("lp_site_out");
        let ws = cwd.join("docs");
        fs::create_dir_all(&ws).unwrap();

        let err = launch_plan(&argv_of(&["export", "docs", "--format", "site"]), &cwd)
            .expect_err("usage error");
        assert!(err.contains("output directory"), "got: {err}");
        let _ = fs::remove_dir_all(&cwd);
    }

    #[test]
    fn launch_plan_rejects_a_blank_output_path() {
        let cwd = unique_tmp("lp_blank");
        fs::create_dir_all(&cwd).unwrap();
        fs::write(cwd.join("note.md"), "# hi").unwrap();

        let err = launch_plan(
            &argv_of(&["export", "note.md", "--format", "pdf", "--out", "   "]),
            &cwd,
        )
        .expect_err("usage error");
        assert!(err.contains("--out needs a path"), "got: {err}");
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
