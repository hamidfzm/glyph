//! The two tools that start another Glyph process. A child never shares this
//! process's stdout, which carries the protocol.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde_json::{json, Value};

use super::refs::{note_schema, read_vault, ref_property, resolve_note, vault_property, NoteArgs};
use super::registry::{arguments, Effect, Session, ToolDef};
use crate::cli::{default_output, ExportFormat};
use crate::vault::Vault;

pub(super) const OPEN_IN_GLYPH: ToolDef = ToolDef {
    name: "open_in_glyph",
    title: "Open in Glyph",
    description: "Show a note to the user in Glyph: in the running app, or in one started for it.",
    input_schema: note_schema,
    effect: Effect::Launches,
    enabled: true,
    handler: open_in_glyph,
};

fn open_in_glyph(session: &Session, args: Value) -> Result<Value, String> {
    let args: NoteArgs = arguments(args)?;
    let path = read_vault(session, args.vault.as_deref(), |vault, root| {
        Ok(resolve_note(session, vault, root, &args.note)?.path)
    })?;
    open(session.exe, &path)?;
    Ok(json!({ "opened": path }))
}

/// macOS keeps one app per bundle and hands it the path as an open event, the
/// way Finder does. Starting the binary instead would open a second app.
#[cfg(target_os = "macos")]
fn open(_exe: &Path, path: &str) -> Result<(), String> {
    let output = Command::new("open")
        .arg("-b")
        .arg(crate::data_dir::IDENTIFIER)
        .arg(path)
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("cannot run open: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
}

/// The single-instance plugin hands a second launch's path to the running
/// app, or the launch becomes the app.
#[cfg(not(target_os = "macos"))]
fn open(exe: &Path, path: &str) -> Result<(), String> {
    let mut command = Command::new(exe);
    command
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    spawn_detached(command).map_err(|err| format!("cannot start Glyph: {err}"))
}

/// Out of the client's job object, so closing the client does not close the
/// app. A job that forbids breaking away refuses the spawn outright, and then
/// the app lives only as long as the client.
#[cfg(windows)]
fn spawn_detached(mut command: Command) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x0100_0000;
    let detached = DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP;
    command.creation_flags(detached | CREATE_BREAKAWAY_FROM_JOB);
    if command.spawn().is_ok() {
        return Ok(());
    }
    command.creation_flags(detached);
    command.spawn().map(drop)
}

/// Its own process group, so a client that signals the server's group does
/// not take the app with it. A thread reaps it, or every forwarded launch
/// would linger as a zombie until the server exits.
#[cfg(all(unix, not(target_os = "macos")))]
fn spawn_detached(mut command: Command) -> std::io::Result<()> {
    use std::os::unix::process::CommandExt;
    let mut child = command.process_group(0).spawn()?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

pub(super) const EXPORT: ToolDef = ToolDef {
    name: "export",
    title: "Export a note",
    description: "Render a note through Glyph's own export pipeline to PDF, DOCX, EPUB or HTML, the same file `glyph export` writes, and return where it went. Without `out` the file lands beside the note. Renders in a hidden webview, so a Linux machine with no display needs xvfb-run around the server.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "format": { "type": "string", "enum": ["pdf", "docx", "epub", "html"] },
                "out": {
                    "type": "string",
                    "description": "Where to write, relative to the vault or absolute. It must be inside an open vault and end in the format's extension."
                },
                "vault": vault_property()
            },
            "required": ["ref", "format"],
            "additionalProperties": false
        })
    },
    effect: Effect::Writes,
    enabled: true,
    handler: export,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExportArgs {
    #[serde(rename = "ref")]
    note: String,
    format: String,
    out: Option<String>,
    vault: Option<String>,
}

fn export(session: &Session, args: Value) -> Result<Value, String> {
    let args: ExportArgs = arguments(args)?;
    let format = ExportFormat::parse(&args.format)
        .filter(|format| *format != ExportFormat::Site)
        .ok_or_else(|| {
            format!(
                "format must be pdf, docx, epub or html, not {:?}",
                args.format
            )
        })?;
    let (input, out) = read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        if !crate::is_markdown_file(Path::new(&found.path)) {
            return Err(format!("{} is not a markdown note", found.path));
        }
        // Beside the note unless told otherwise, as the command line puts it.
        // Named here rather than read back from the child, so the result can
        // say where the file went.
        let out = match &args.out {
            Some(out) => out.clone(),
            None => default_output(&found.path, format),
        };
        Ok((
            found.path,
            export_target(session, vault, root, &out, format)?,
        ))
    })?;
    run_export(session.exe, &input, format, &out)?;
    Ok(json!({ "path": out }))
}

/// `out` inside the vault being read and named for the format, so an export
/// cannot leave the vault or land on a note: `out: "Plan.md"` would replace it.
fn export_target(
    session: &Session,
    vault: &Vault,
    root: &str,
    out: &str,
    format: ExportFormat,
) -> Result<String, String> {
    let path = if Path::new(out).is_absolute() {
        PathBuf::from(out)
    } else {
        Path::new(root).join(out)
    };
    let extension = format.extension().unwrap_or_default();
    let named_for_format = path
        .extension()
        .is_some_and(|found| found.eq_ignore_ascii_case(extension));
    if !named_for_format {
        return Err(format!(
            "out must end in .{extension} for the {} format",
            format.as_str()
        ));
    }
    let canonical = session.grants.ensure_writable(&path.to_string_lossy())?;
    // Grants outlive the vaults a session serves, so they alone do not keep an
    // export inside this one.
    if vault.inside_root(&canonical).is_none() {
        return Err(format!("out must be inside the vault {root}"));
    }
    Ok(path.to_string_lossy().to_string())
}

/// Run `glyph export`, passing its stderr through as it is when it fails.
fn run_export(exe: &Path, input: &str, format: ExportFormat, out: &str) -> Result<(), String> {
    let mut command = Command::new(exe);
    command
        .arg("export")
        .arg(input)
        .arg("--format")
        .arg(format.as_str())
        .arg("--out")
        .arg(out);
    #[cfg(windows)]
    {
        // A debug build is a console program; without this, every export
        // flashes a console window.
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let output = command
        .stdin(Stdio::null())
        .output()
        .map_err(|err| format!("cannot run glyph export: {err}"))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        return Err(format!("glyph export failed ({})", output.status));
    }
    Err(message)
}
