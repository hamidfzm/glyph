//! What every vault tool shares: choosing the vault, resolving a note
//! reference, reading a note through the grant check, and bounding results.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::registry::Session;
use crate::cli::plain_path;
use crate::commands::walk::SCAN_MAX_FILE_BYTES;
use crate::vault::{split_heading, with_synced_vault, Vault};

/// Most rows one listing returns. A listing that had more says so.
pub(super) const MAX_ITEMS: usize = 200;
/// Most characters of note text one result carries.
pub(super) const MAX_TEXT_CHARS: usize = 50_000;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct NoteArgs {
    #[serde(rename = "ref")]
    pub note: String,
    pub vault: Option<String>,
}

pub(super) fn vault_property() -> Value {
    json!({
        "type": "string",
        "description": "Root folder of the vault to read. Defaults to the vault of the note open in Glyph, or to the only vault; vault_context lists them. Any other folder, given as an absolute path, is served once the user allows it."
    })
}

pub(super) fn ref_property() -> Value {
    json!({
        "type": "string",
        "description": "The note: a wikilink target such as `Note`, `Folder/Note`, `Note#Heading` or `[[Note|alias]]`, a path relative to the vault, or an absolute path."
    })
}

pub(super) fn note_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "ref": ref_property(), "vault": vault_property() },
        "required": ["ref"],
        "additionalProperties": false
    })
}

/// At most [`MAX_ITEMS`] of `items`, with the total, so a partial list never
/// passes for a whole one.
pub(super) fn capped<T: Serialize>(items: impl ExactSizeIterator<Item = T>) -> Value {
    let total = items.len();
    let kept: Vec<T> = items.take(MAX_ITEMS).collect();
    json!({ "items": kept, "total": total, "cut": total > MAX_ITEMS })
}

/// `text` cut to [`MAX_TEXT_CHARS`], and whether anything went.
pub(super) fn cut_text(text: &str) -> (&str, bool) {
    match text.char_indices().nth(MAX_TEXT_CHARS) {
        Some((end, _)) => (&text[..end], true),
        None => (text, false),
    }
}

/// Run `read` against the chosen vault's index, caught up with the disk.
pub(super) fn read_vault<T>(
    session: &Session,
    requested: Option<&str>,
    read: impl FnOnce(&Vault, &str) -> Result<T, String>,
) -> Result<T, String> {
    let root = pick_vault(session, requested)?;
    if !Path::new(&root).is_dir() {
        return Err(format!("the vault folder {root} no longer exists"));
    }
    with_synced_vault(&root, session.grants, session.vaults, |vault| {
        read(vault, &root)
    })
}

/// The root a call reads: the one it names, else the vault holding the note
/// open in Glyph, else the only vault. A named folder the session does not
/// serve yet is served only once the user allows it.
fn pick_vault(session: &Session, requested: Option<&str>) -> Result<String, String> {
    let roots = &session.open.roots;
    let grants = session.grants;
    if let Some(requested) = requested {
        // Spelled as listed: picked without touching the disk, so a vault
        // deleted since is reported as gone rather than as unknown.
        if let Some(root) = roots.iter().find(|root| root.as_str() == requested) {
            return Ok(root.clone());
        }
        refuse_remote(requested)?;
        if let Ok(wanted) = grants.ensure_workspace(requested) {
            let listed = roots.iter().find(|root| {
                grants
                    .ensure_workspace(root)
                    .is_ok_and(|root| root == wanted)
            });
            if let Some(root) = listed {
                return Ok(root.clone());
            }
        }
        return add_vault(session, requested);
    }
    if roots.is_empty() {
        return Err(format!("no vault is open: {}", how_to_add_a_vault(session)));
    }
    let active = session
        .open
        .active_note
        .as_deref()
        .and_then(|note| grants.ensure_readable(note).ok());
    if let Some(active) = active {
        let holding = roots.iter().find(|root| {
            grants
                .ensure_workspace(root)
                .is_ok_and(|root| active.starts_with(root))
        });
        if let Some(root) = holding {
            return Ok(root.clone());
        }
    }
    match roots.as_slice() {
        [only] => Ok(only.clone()),
        _ => Err(format!(
            "several vaults are open; pass `vault` as one of: {}",
            roots.join(", ")
        )),
    }
}

/// `requested`, a folder the session does not serve, served from now on if
/// the user allows it.
fn add_vault(session: &Session, requested: &str) -> Result<String, String> {
    // Nothing is looked up on disk until someone can be asked.
    let Some(allow_vault) = session.allow_vault else {
        return Err(format!(
            "{requested} is not an open vault (vault_context lists them), and this session cannot ask the user for another"
        ));
    };
    if !Path::new(requested).is_absolute() {
        return Err(format!(
            "{requested} is not an open vault (vault_context lists them); to ask the user for another folder, give its absolute path"
        ));
    }
    let resolved = Path::new(requested)
        .canonicalize()
        .ok()
        .filter(|path| path.is_dir())
        .ok_or_else(|| format!("{requested} is not a folder"))?;
    let root = plain_path(&resolved.to_string_lossy());
    // The path is all the user sees of the request.
    if root.chars().any(disguises) {
        return Err(format!(
            "{requested} cannot be put to the user: its path holds a character that could disguise it"
        ));
    }
    allow_vault(&root).map_err(|reason| format!("{root} was not opened: {reason}"))?;
    // Exactly what the user saw: resolving it again could follow a link
    // swapped in while they decided.
    session.grants.grant_resolved_workspace(resolved)?;
    Ok(root)
}

/// What the agent can do about a vault this session does not serve.
pub(super) fn how_to_add_a_vault(session: &Session) -> &'static str {
    if session.allow_vault.is_some() {
        "give a folder's absolute path as `vault` and the user is asked to allow it, or open a folder in Glyph"
    } else {
        "open a folder in Glyph, or start the server with --vault <folder>"
    }
}

/// A character that would let a path read as something else on the user's
/// screen: a control character, a line or paragraph separator, or a
/// bidirectional mark or override.
fn disguises(c: char) -> bool {
    const MARKS: [char; 5] = ['\u{061c}', '\u{200e}', '\u{200f}', '\u{2028}', '\u{2029}'];
    c.is_control()
        || MARKS.contains(&c)
        || ('\u{202a}'..='\u{202e}').contains(&c)
        || ('\u{2066}'..='\u{2069}').contains(&c)
}

/// Refuse a path naming a network share or a device. Resolving one connects
/// to the host, which can hand it the user's credentials, and a model can name
/// any host it likes.
#[cfg(windows)]
pub(super) fn refuse_remote(raw: &str) -> Result<(), String> {
    use std::path::{Component, Prefix};
    let local = match Path::new(raw).components().next() {
        Some(Component::Prefix(prefix)) => {
            matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        }
        _ => true,
    };
    if local {
        Ok(())
    } else {
        Err(format!(
            "{raw} is a network or device path, which is never looked up"
        ))
    }
}

/// Only Windows resolves a path by connecting to the host it names.
#[cfg(not(windows))]
pub(super) fn refuse_remote(_: &str) -> Result<(), String> {
    Ok(())
}

/// A note a call named, and the heading its reference carried.
pub(super) struct NoteRef {
    pub path: String,
    pub heading: Option<String>,
}

/// The target of a reference written as a link: no leading `!`, no `[[ ]]`,
/// no `|alias`.
pub(super) fn link_target(raw: &str) -> &str {
    let bare = raw.trim().trim_start_matches('!');
    let inner = bare
        .strip_prefix("[[")
        .and_then(|rest| rest.strip_suffix("]]"))
        .unwrap_or(bare);
    inner.split_once('|').map_or(inner, |(target, _)| target)
}

/// Resolve `raw` in `vault`. A path is tried before a wikilink target, so a
/// file whose name holds a `#` stays reachable.
pub(super) fn resolve_note(
    session: &Session,
    vault: &Vault,
    root: &str,
    raw: &str,
) -> Result<NoteRef, String> {
    if raw.trim().is_empty() {
        return Err("the note reference is empty".to_string());
    }
    if let Some(path) = note_path(session, vault, root, raw.trim())? {
        return Ok(NoteRef {
            path,
            heading: None,
        });
    }
    let target = link_target(raw);
    let found = vault
        .resolve_link(target, None)
        .ok_or_else(|| format!("no note in {root} goes by {raw:?}"))?;
    Ok(NoteRef {
        path: found.path.to_string(),
        heading: split_heading(target).1.map(str::to_string),
    })
}

/// `raw` as the path of an indexed note, or `None` when it names no file here
/// and may be a wikilink target instead. An absolute path is never a target,
/// so a refusal there is final.
pub(super) fn note_path(
    session: &Session,
    vault: &Vault,
    root: &str,
    raw: &str,
) -> Result<Option<String>, String> {
    let absolute = Path::new(raw).is_absolute();
    let candidate = if absolute {
        refuse_remote(raw)?;
        PathBuf::from(raw)
    } else {
        Path::new(root).join(raw)
    };
    let checked = session.grants.ensure_readable(&candidate.to_string_lossy());
    let readable_file = checked.as_ref().is_ok_and(|path| path.is_file());
    // Nothing to read here, so perhaps a wikilink target instead.
    if !absolute && !readable_file {
        return Ok(None);
    }
    let canonical = checked?;
    if !canonical.is_file() {
        return Err(format!("{raw} is not a file"));
    }
    let Some((indexed, _)) = vault.inside_root(&canonical) else {
        return Err(format!(
            "{raw} is not in the vault {root}; pass `vault` to read another one"
        ));
    };
    let indexed = indexed.to_string_lossy().to_string();
    if vault.note(&indexed).is_none() {
        return Err(format!(
            "{raw} is not a note Glyph indexes: markdown or a canvas, outside hidden folders, under 5 MB"
        ));
    }
    Ok(Some(indexed))
}

/// A note's text, read through the grant check and refused past the size the
/// index refuses.
pub(super) fn read_text(session: &Session, path: &str) -> Result<String, String> {
    let canonical = session.grants.ensure_readable(path)?;
    let size = std::fs::metadata(&canonical)
        .map_err(|err| format!("cannot read {path}: {err}"))?
        .len();
    if size > SCAN_MAX_FILE_BYTES {
        return Err(format!("{path} is larger than the 5 MB Glyph indexes"));
    }
    std::fs::read_to_string(&canonical).map_err(|err| format!("cannot read {path}: {err}"))
}
