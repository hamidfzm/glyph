//! What every vault tool shares: choosing the vault, resolving a note
//! reference, reading a note through the grant check, and bounding results.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::registry::Session;
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
        "description": "Root folder of the vault to read. Defaults to the vault of the note open in Glyph, or to the only vault; vault_context lists them."
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
/// open in Glyph, else the only vault. Only roots from `--vault` or the app's
/// session qualify; an argument can pick one but never add one.
fn pick_vault(session: &Session, requested: Option<&str>) -> Result<String, String> {
    let roots = &session.open.roots;
    if roots.is_empty() {
        return Err(
            "no vault is open: start the server with --vault <folder>, or open a folder in Glyph"
                .to_string(),
        );
    }
    let grants = session.grants;
    if let Some(requested) = requested {
        // Spelled as listed: picked without touching the disk, so a vault
        // deleted since is reported as gone rather than as unknown.
        if let Some(root) = roots.iter().find(|root| root.as_str() == requested) {
            return Ok(root.clone());
        }
        let not_open = || {
            format!(
                "{requested} is not an open vault; the vaults are: {}",
                roots.join(", ")
            )
        };
        let wanted = grants.ensure_workspace(requested).map_err(|_| not_open())?;
        return roots
            .iter()
            .find(|root| {
                grants
                    .ensure_workspace(root)
                    .is_ok_and(|root| root == wanted)
            })
            .cloned()
            .ok_or_else(not_open);
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
