//! What every tool that changes a note shares: the checks before a write, and
//! the write itself.

use std::path::{Path, PathBuf};

use serde_json::{json, Value};

use super::refs::{read_raw, read_vault, resolve_note, NoteRef, MAX_NOTE_MB};
use super::registry::Session;
use crate::commands::walk::SCAN_MAX_FILE_BYTES;
use crate::data_dir::OpenDocuments;
use crate::vault::{strip_bom, write_unchanged, Vault};

/// Opens the refusal for a note holding unsaved edits, so a caller can tell
/// it from every other refusal.
pub(super) const UNSAVED: &str = "unsaved changes";
/// Opens the refusal for a note open in a window, which a move would strand.
pub(super) const OPEN: &str = "open in Glyph";

/// What an edit worked out against a note's text.
pub(super) struct Outcome {
    /// The note's new text, or `None` when the edit leaves it as it is.
    pub text: Option<String>,
    /// One sentence on what changed, or on why nothing did.
    pub summary: String,
}

/// Resolve `note`, let `edit` work a change out against its text as it stands
/// on disk, and write the result. Each check that fails stops the call with
/// the file untouched.
pub(super) fn edit_note(
    session: &Session,
    vault: Option<&str>,
    note: &str,
    edit: impl FnOnce(&str, &NoteRef) -> Result<Outcome, String>,
) -> Result<Value, String> {
    read_vault(session, vault, |vault, root| {
        let found = resolve_note(session, vault, root, note)?;
        let path = &found.path;
        if !crate::is_markdown_file(Path::new(path)) {
            return Err(format!("{path} is not a markdown note"));
        }
        let target = writable(session, vault, root, path)?;
        refuse_unsaved(session, &target, path)?;
        let raw = read_raw(session, path)?;
        let text = strip_bom(&raw);
        let outcome = edit(text, &found)?;
        let Some(edited) = outcome.text else {
            return Ok(json!({ "path": path, "changed": false, "summary": outcome.summary }));
        };
        let edited = format!("{}{edited}", &raw[..raw.len() - text.len()]);
        if edited.len() as u64 > SCAN_MAX_FILE_BYTES {
            return Err(format!(
                "{path} would grow past the {MAX_NOTE_MB} MB Glyph indexes; nothing was written"
            ));
        }
        match write_unchanged(&target, &raw, &edited) {
            Ok(true) => Ok(json!({ "path": path, "changed": true, "summary": outcome.summary })),
            Ok(false) => Err(format!(
                "{path} changed on disk while the edit was being worked out. Nothing was written; call again to edit it as it is now."
            )),
            Err(err) => Err(format!("cannot write {path}: {err}")),
        }
    })
}

/// The file a write to `path` lands on: inside the grants, and inside the
/// vault being read, which the grants alone do not ensure once a session
/// serves several vaults.
pub(super) fn writable(
    session: &Session,
    vault: &Vault,
    root: &str,
    path: &str,
) -> Result<PathBuf, String> {
    let canonical = session.grants.ensure_writable(path)?;
    if vault.inside_root(&canonical).is_none() {
        return Err(format!("{path} is not inside the vault {root}"));
    }
    Ok(canonical)
}

/// What the running app has open; `None` while it is closed, when nothing is.
fn documents<'a>(session: &'a Session) -> Result<Option<&'a OpenDocuments>, String> {
    if !session.open.app_running {
        return Ok(None);
    }
    match &session.open.documents {
        Some(documents) => Ok(Some(documents)),
        None => Err(
            "Glyph is running but has not said which notes are being edited, so nothing was written. Call again in a moment."
                .to_string(),
        ),
    }
}

/// Whether `target` is one of `paths`, however the app spells it.
fn lists(session: &Session, paths: &[String], target: &Path) -> bool {
    paths.iter().any(|path| {
        let listed = session.grants.ensure_readable(path);
        listed.is_ok_and(|listed| listed == target)
    })
}

/// Refuse to write over a note holding unsaved edits in a running window. The
/// app keeps its buffer over a change on disk, so the write would be undone
/// by the next save without anyone being told.
pub(super) fn refuse_unsaved(session: &Session, target: &Path, shown: &str) -> Result<(), String> {
    let editing = documents(session)?.is_some_and(|open| lists(session, &open.unsaved, target));
    if editing {
        return Err(format!(
            "{UNSAVED}: {shown} is being edited in Glyph and holds changes that are not saved. Nothing was written. Call again once the user has saved or discarded them."
        ));
    }
    Ok(())
}

/// Refuse to move a note that is open in a running window, saved or not. The
/// app does not follow a move made outside it: the tab would keep the old
/// path, and its next save would bring the old file back.
pub(super) fn refuse_open(session: &Session, target: &Path, shown: &str) -> Result<(), String> {
    let open = documents(session)?.is_some_and(|open| {
        lists(session, &open.open, target) || lists(session, &open.unsaved, target)
    });
    if open {
        return Err(format!(
            "{OPEN}: {shown} is open in a Glyph window, which would go on showing and saving it under its old path. Nothing was moved. Call again once the user has closed its tab, or let the user rename it in Glyph."
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::tests::Harness;
    use super::*;

    const NOTE: &str = "Notes/Travel.md";

    fn append() -> Value {
        json!({ "ref": NOTE, "section": "Travel", "content": "added", "mode": "append" })
    }

    #[test]
    fn a_note_with_unsaved_changes_in_a_window_is_not_written_over() {
        let mut h = Harness::writing("edits_unsaved");
        let before = h.read(NOTE);
        // However the app spells the path it reports.
        h.editing(&[NOTE, "Index.md"], &["Notes/../Notes/Travel.md"]);
        let calls = [
            ("patch_note", append()),
            (
                "set_property",
                json!({ "ref": NOTE, "key": "status", "value": "x" }),
            ),
            (
                "update_task",
                json!({ "ref": NOTE, "task": "x", "state": "done" }),
            ),
        ];
        for (tool, args) in calls {
            let refusal = h.refused(tool, args);
            assert!(refusal.starts_with(UNSAVED), "{tool}: {refusal}");
        }
        assert_eq!(h.read(NOTE), before);

        // A note open and saved is written; the window reloads it from disk.
        let saved = json!({ "ref": "Index", "key": "status", "value": "draft" });
        assert_eq!(h.ok("set_property", saved)["changed"], true);
        h.editing(&[NOTE], &[]);
        assert_eq!(h.ok("patch_note", append())["changed"], true);
    }

    #[test]
    fn a_running_app_that_has_not_said_what_is_unsaved_stops_every_write() {
        let mut h = Harness::writing("edits_unreported");
        let before = h.read(NOTE);
        h.running_unreported();
        let refusal = h.refused("patch_note", append());
        assert!(refusal.contains("has not said"), "{refusal}");
        assert!(!refusal.starts_with(UNSAVED));
        let refusal = h.refused("rename_note", json!({ "ref": NOTE, "to": "Trip" }));
        assert!(refusal.contains("has not said"), "{refusal}");
        assert_eq!(h.read(NOTE), before);
    }

    #[test]
    fn a_note_changed_while_the_edit_was_worked_out_keeps_its_new_content() {
        let h = Harness::writing("edits_raced");
        let path = h.path(NOTE);
        let raced = edit_note(&h.session(), None, NOTE, |text, _| {
            // An editor, or a sync pull, saves between the read and the write.
            std::fs::write(&path, "typed meanwhile\n").unwrap();
            Ok(Outcome {
                text: Some(format!("{text}appended\n")),
                summary: String::new(),
            })
        });
        assert!(raced.unwrap_err().contains("changed on disk"));
        assert_eq!(h.read(NOTE), "typed meanwhile\n");
    }

    #[test]
    fn an_edit_that_changes_nothing_or_cannot_be_made_writes_nothing() {
        let h = Harness::writing("edits_untouched");
        let before = h.read(NOTE);
        let unchanged = |_: &str, _: &NoteRef| {
            Ok(Outcome {
                text: None,
                summary: "as it was".to_string(),
            })
        };
        let result = edit_note(&h.session(), None, NOTE, unchanged).unwrap();
        assert_eq!(
            result,
            json!({ "path": h.path(NOTE), "changed": false, "summary": "as it was" })
        );

        let refused = edit_note(&h.session(), None, NOTE, |_, _| Err("no".to_string()));
        assert_eq!(refused.unwrap_err(), "no");
        // Past the size the index reads, the note would drop out of the vault.
        let grown = edit_note(&h.session(), None, NOTE, |_, _| {
            Ok(Outcome {
                text: Some("x".repeat(SCAN_MAX_FILE_BYTES as usize + 1)),
                summary: String::new(),
            })
        });
        assert!(grown.unwrap_err().contains("5 MB"));
        // A board is JSON: none of these edits apply to it.
        let board = edit_note(&h.session(), None, "Board.canvas", unchanged).unwrap_err();
        assert!(board.contains("not a markdown note"), "{board}");
        assert_eq!(h.read(NOTE), before);
    }

    #[test]
    fn a_file_that_cannot_be_written_says_so() {
        let h = Harness::writing("edits_read_only");
        let path = h.path(NOTE);
        let writable = std::fs::metadata(&path).unwrap().permissions();
        let mut read_only = writable.clone();
        read_only.set_readonly(true);
        std::fs::set_permissions(&path, read_only).unwrap();

        let refusal = h.refused("patch_note", append());
        std::fs::set_permissions(&path, writable).unwrap();
        assert!(refusal.starts_with("cannot write"), "{refusal}");
    }
}
