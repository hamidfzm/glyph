//! What every tool that changes a note shares: the checks before a write, and
//! the write itself.

use std::path::Path;

use serde_json::{json, Value};

use super::refs::{read_raw, read_vault, resolve_note, NoteRef, MAX_NOTE_MB};
use super::registry::Session;
use crate::commands::walk::SCAN_MAX_FILE_BYTES;
use crate::data_dir::{Editing, OpenDocuments};
use crate::vault::{strip_bom, write_unchanged};

/// Opens the refusal for a note holding unsaved edits, so a caller can tell
/// it from every other refusal.
pub(super) const UNSAVED: &str = "unsaved changes";
/// Opens the refusal for a note a window has open and would save its own
/// copy of: one being moved, or any at all while Auto Reload is off.
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
        let target = session.grants.ensure_writable(path)?;
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

/// What the running app's windows hold, asked now; `None` while no app runs.
fn documents(session: &Session) -> Result<Option<OpenDocuments>, String> {
    match (session.editing)() {
        Editing::Closed => Ok(None),
        Editing::Open(documents) => Ok(Some(documents)),
        Editing::Unknown => Err(
            "Glyph is running, or may be, and has not said which notes are being edited, so nothing was written. A Glyph older than this server never says, and neither does one whose data folder cannot hold a lock; closing Glyph lets the call through."
                .to_string(),
        ),
    }
}

/// Whether `target` is one of `paths`, however the app spells it. Resolved
/// through the grants as they stand now, a folder allowed during this call
/// included.
fn lists(session: &Session, paths: &[String], target: &Path) -> bool {
    paths.iter().any(|path| {
        let listed = session.grants.ensure_readable(path);
        listed.is_ok_and(|listed| listed == target)
    })
}

/// Refuse to write a note the running app would not take the change from.
/// One holding unsaved edits: the app keeps its buffer over a change on disk,
/// so the next save would undo the write without anyone being told. And, with
/// Auto Reload off, any note open in a window, which goes on showing the old
/// text and saves that back.
pub(super) fn refuse_unsaved(session: &Session, target: &Path, shown: &str) -> Result<(), String> {
    let Some(documents) = documents(session)? else {
        return Ok(());
    };
    if lists(session, &documents.unsaved, target) {
        return Err(format!(
            "{UNSAVED}: {shown} is being edited in Glyph and holds changes that are not saved. Nothing was written. Call again once the user has saved or discarded them."
        ));
    }
    if session.open.auto_reload_off && lists(session, &documents.open, target) {
        return Err(format!(
            "{OPEN}: {shown} is open in a Glyph window, and Auto Reload is turned off there, so the window would keep its old text and save it over this change. Nothing was written. Call again once the user has closed its tab or turned Auto Reload on."
        ));
    }
    Ok(())
}

/// Refuse to move a note that is open in a running window, saved or not. The
/// app does not follow a move made outside it: the tab would keep the old
/// path, and its next save would bring the old file back.
pub(super) fn refuse_open(session: &Session, target: &Path, shown: &str) -> Result<(), String> {
    let Some(documents) = documents(session)? else {
        return Ok(());
    };
    if lists(session, &documents.open, target) || lists(session, &documents.unsaved, target) {
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
    fn with_auto_reload_off_a_note_open_in_a_window_is_not_written() {
        // The window would keep showing the old text and save it back over
        // the change, saved tab or not.
        let mut h = Harness::writing("edits_no_reload");
        let before = h.read(NOTE);
        h.editing(&[NOTE], &[]);
        h.auto_reload_off();
        let refusal = h.refused("patch_note", append());
        assert!(refusal.starts_with(OPEN), "{refusal}");
        assert!(refusal.contains("Auto Reload"), "{refusal}");
        assert_eq!(h.read(NOTE), before);
        // So is a note whose links a rename would rewrite.
        h.editing(&["Index.md"], &[]);
        let refusal = h.refused("rename_note", json!({ "ref": NOTE, "to": "Trip" }));
        assert!(
            refusal.starts_with(OPEN) && refusal.contains("Index.md"),
            "{refusal}"
        );
        assert!(h.root.join("Notes").join("Travel.md").is_file());

        // A note no window holds is written all the same.
        let closed = json!({ "ref": "Aliased", "key": "status", "value": "x" });
        assert_eq!(h.ok("set_property", closed)["changed"], true);
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
    fn a_note_may_grow_to_the_size_the_index_reads_and_no_further() {
        let h = Harness::writing("edits_size_cap");
        let sized = |bytes: u64| {
            edit_note(&h.session(), None, NOTE, |_, _| {
                Ok(Outcome {
                    text: Some("x".repeat(bytes as usize)),
                    summary: String::new(),
                })
            })
        };
        assert!(sized(SCAN_MAX_FILE_BYTES + 1).is_err());
        assert_eq!(sized(SCAN_MAX_FILE_BYTES).unwrap()["changed"], true);
        // Still a note the index holds, so the next call finds it.
        h.ok("read_note", json!({ "ref": NOTE }));
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
