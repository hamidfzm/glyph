//! Tools that rename or move a note, rewriting the links the move would
//! break, as renaming it in the app does.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};

use super::edits::{refuse_open, refuse_unsaved};
use super::refs::{capped, read_vault, ref_property, resolve_note, vault_property};
use super::registry::{arguments, Effect, Session, ToolDef};
use crate::commands::create::UNSAFE_NAME_CHARS;
use crate::commands::walk::WALK_SKIP_DIRS;
use crate::vault::{relocate, respelled};

/// What both tools promise, closing each one's description.
macro_rules! relinking {
    () => {
        " Every link the move would break is rewritten to follow it: wikilinks in each form, markdown links, embeds and canvas cards, and the note's own relative links. A link that still resolves to the same note is left as written, and so is anything in code. The result lists the notes whose links changed; if the rewrite could not finish, `failed` names the note it stopped at, and the notes before it stay rewritten. Refused when the destination exists, when the note is open in a Glyph window, and when a note whose links would change holds unsaved changes there."
    };
}

fn move_schema(to: &str) -> Value {
    json!({
        "type": "object",
        "properties": {
            "ref": ref_property(),
            "to": { "type": "string", "description": to },
            "vault": vault_property()
        },
        "required": ["ref", "to"],
        "additionalProperties": false
    })
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MoveArgs {
    #[serde(rename = "ref")]
    note: String,
    to: String,
    vault: Option<String>,
}

pub(super) const RENAME_NOTE: ToolDef = ToolDef {
    name: "rename_note",
    title: "Rename a note",
    description: concat!(
        "Give a note a new name in the folder it is in.",
        relinking!()
    ),
    input_schema: || {
        move_schema("The new name, with no folder in it. The note keeps its extension whether or not the name carries it.")
    },
    effect: Effect::Edits,
    handler: rename_note,
};

fn rename_note(session: &Session, args: Value) -> Result<Value, String> {
    let args: MoveArgs = arguments(args)?;
    relocate_note(session, &args, |source, _| {
        let name = args.to.trim();
        let one_name =
            !name.is_empty() && !matches!(name, "." | "..") && !name.contains(UNSAFE_NAME_CHARS);
        if !one_name {
            return Err(format!(
                "{name:?} is not a file name: it must be one name, holding none of {UNSAFE_NAME_CHARS:?}. move_note moves a note to another folder."
            ));
        }
        let extension = source.extension().unwrap_or_default();
        let carries_it = Path::new(name)
            .extension()
            .is_some_and(|found| found.eq_ignore_ascii_case(extension));
        if carries_it {
            return Ok(source.with_file_name(name));
        }
        Ok(source.with_file_name(format!("{name}.{}", extension.to_string_lossy())))
    })
}

pub(super) const MOVE_NOTE: ToolDef = ToolDef {
    name: "move_note",
    title: "Move a note",
    description: concat!(
        "Move a note into another folder of its vault, keeping its name.",
        relinking!()
    ),
    input_schema: || {
        move_schema("The folder to move into, relative to the vault or absolute; `.` is the vault's root. It has to exist already.")
    },
    effect: Effect::Edits,
    handler: move_note,
};

fn move_note(session: &Session, args: Value) -> Result<Value, String> {
    let args: MoveArgs = arguments(args)?;
    relocate_note(session, &args, |source, root| {
        // An absolute `to` replaces the root it is joined to, so it is checked
        // before the disk is asked anything about it: looking a network path
        // up connects to its host, and any answer about a folder outside the
        // grants is one the caller should not get.
        let to = args.to.trim();
        if to.is_empty() {
            return Err("`to` is empty; `.` names the vault's root".to_string());
        }
        let folder = Path::new(root).join(to);
        session.grants.ensure_writable(&folder.to_string_lossy())?;
        if !folder.is_dir() {
            return Err(format!(
                "{:?} is not a folder in the vault {root}; move_note moves into a folder that already exists",
                args.to
            ));
        }
        Ok(folder.join(source.file_name().unwrap_or_default()))
    })
}

enum Planned {
    Move {
        root: String,
        from: String,
        target: PathBuf,
    },
    /// The note already sits at the destination, under this path.
    AlreadyThere(String),
}

/// Move the note `args` names to wherever `target_of` puts it, given the
/// note's path and the vault's root.
fn relocate_note(
    session: &Session,
    args: &MoveArgs,
    target_of: impl FnOnce(&Path, &str) -> Result<PathBuf, String>,
) -> Result<Value, String> {
    let planned = read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        let source = PathBuf::from(&found.path);
        let source_file = session.grants.ensure_writable(&found.path)?;
        refuse_open(session, &source_file, &found.path)?;

        let asked = target_of(&source, root)?;
        let resolved = session.grants.ensure_writable(&asked.to_string_lossy())?;
        // Grants outlive the vaults a session serves, so they alone do not
        // keep a move inside this one. Spelled as the index spells it, like
        // every path a result carries.
        let Some((target, relative)) = vault.inside_root(&resolved) else {
            return Err(format!(
                "{} is not inside the vault {root}",
                asked.display()
            ));
        };
        // The note's own name in other letters is a rename in place, with
        // nothing in its way.
        let in_place = respelled(&source, &asked);
        if resolved == source_file && !in_place {
            return Ok(Planned::AlreadyThere(found.path));
        }
        let skipped = relative.components().any(|part| {
            let name = part.as_os_str().to_string_lossy();
            name.starts_with('.') || WALK_SKIP_DIRS.contains(&name.as_ref())
        });
        if skipped {
            return Err(format!(
                "{} is somewhere Glyph does not index (a hidden name, or one of {WALK_SKIP_DIRS:?}), so the note would drop out of the vault",
                target.display()
            ));
        }
        // `symlink_metadata`, so a dangling link in the way counts as there.
        // ponytail: checked here, renamed later, so a file created in between
        // is replaced, as it is for a rename made in the app; a no-replace
        // rename in `relocate` would close that for both.
        if !in_place && std::fs::symlink_metadata(&target).is_ok() {
            return Err(format!(
                "{} already exists. Nothing was moved; pick another name.",
                target.display()
            ));
        }
        // Under the name asked for, which is not the one the filesystem
        // answers with for a note reached by another spelling.
        let name = asked.file_name().unwrap_or_default();
        Ok(Planned::Move {
            root: root.to_string(),
            from: found.path,
            target: target.with_file_name(name),
        })
    })?;
    let (root, from, target) = match planned {
        Planned::Move { root, from, target } => (root, from, target),
        Planned::AlreadyThere(path) => {
            let summary = format!("{path} is already there under that name; nothing changed");
            return Ok(json!({ "path": path, "changed": false, "summary": summary }));
        }
    };
    let source = Path::new(&from);

    // Outside the index's lock, which `relocate` takes itself.
    let (grants, vaults) = (session.grants, session.vaults);
    let preview = relocate(&root, source, &target, true, grants, vaults)?;
    for file in &preview.files {
        let linking = grants.ensure_writable(&file.path)?;
        refuse_unsaved(session, &linking, &file.path)?;
    }
    let moved = relocate(&root, source, &target, false, grants, vaults)?;

    let links: usize = moved.files.iter().map(|file| file.links).sum();
    let mut summary = format!(
        "Moved {from} to {}, rewriting {links} links in {} notes",
        moved.new_path,
        moved.files.len()
    );
    if let Some(failed) = &moved.failed {
        summary.push_str(&format!(
            ". The rewrite stopped at {}: {}. Links in that note, and in any after it, still point at the old path",
            failed.path, failed.error
        ));
    }
    Ok(json!({
        "path": moved.new_path,
        "from": from,
        "changed": true,
        "summary": summary,
        "relinked": capped(moved.files.iter()),
        "failed": moved.failed,
    }))
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::super::edits::{OPEN, UNSAVED};
    use super::super::test_support::Harness;
    use super::*;
    use crate::grants::GrantRegistry;
    use crate::vault::test_support::fixture_vault;
    use crate::vault::VaultStore;

    fn rename(h: &Harness, note: &str, to: &str) -> Value {
        h.ok("rename_note", json!({ "ref": note, "to": to }))
    }

    fn relinked(h: &Harness, result: &Value) -> Vec<String> {
        let files = result["relinked"]["items"].as_array().unwrap();
        files.iter().map(|file| h.relative(&file["path"])).collect()
    }

    #[test]
    fn rename_note_rewrites_the_links_the_app_would() {
        let h = Harness::writing("move_rename");
        let result = rename(&h, "Notes/Travel", "Trip");
        assert_eq!(h.relative(&result["path"]), "Notes/Trip.md");
        assert_eq!(h.relative(&result["from"]), "Notes/Travel.md");
        assert_eq!(result["changed"], true);
        assert_eq!(result["failed"], Value::Null);
        assert_eq!(relinked(&h, &result), ["Index.md"]);
        let summary = result["summary"].as_str().unwrap();
        assert!(
            summary.contains("rewriting 1 links in 1 notes"),
            "{summary}"
        );
        assert!(!h.root.join("Notes").join("Travel.md").exists());

        // The same move made the way the app makes it leaves the same vault.
        let app = fixture_vault("move_rename_app");
        let grants = GrantRegistry::default();
        grants.grant_workspace(&app).unwrap();
        let (from, to) = (
            app.join("Notes").join("Travel.md"),
            app.join("Notes").join("Trip.md"),
        );
        let root = app.to_string_lossy();
        relocate(&root, &from, &to, false, &grants, &VaultStore::default()).unwrap();
        for note in ["Index.md", "Notes/Trip.md", "Archive/Travel.md"] {
            let by_app = fs::read_to_string(app.join(note)).unwrap();
            assert_eq!(h.read(note), by_app, "{note}");
        }
        assert!(h.read("Index.md").contains("[[Notes/Trip]]"));
        fs::remove_dir_all(&app).unwrap();

        // The index has caught up: the old name is gone from the next answer.
        let found = h.ok("resolve_link", json!({ "ref": "Trip" }));
        assert_eq!(h.relative(&found["resolution"]["path"]), "Notes/Trip.md");
    }

    /// The names a folder of the vault lists, as it spells them.
    fn listed(h: &Harness, folder: &str) -> Vec<String> {
        let entries = fs::read_dir(h.root.join(folder)).unwrap();
        let mut names: Vec<String> = entries
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn rename_note_changes_the_case_of_a_name() {
        // Where the filesystem ignores case, the new name already reaches the
        // note, which is neither a note in the way nor the name it has.
        let h = Harness::writing("move_case");
        let result = rename(&h, "Notes/Travel", "travel");
        assert_eq!(result["changed"], true, "{result}");
        assert_eq!(h.relative(&result["path"]), "Notes/travel.md");
        assert_eq!(
            listed(&h, "Notes"),
            ["Cooking.md", "Sections.md", "travel.md"]
        );

        // The index holds one note, under the new spelling: it answers as an
        // index built from the folder now does.
        let found = h.ok("resolve_link", json!({ "ref": "Notes/Travel" }));
        assert_eq!(h.relative(&found["resolution"]["path"]), "Notes/travel.md");
        let fresh = std::mem::ManuallyDrop::new(Harness::over(h.root.clone()));
        let report = |h: &Harness| h.ok("vault_report", json!({}));
        assert_eq!(report(&h), report(&fresh));

        // And the name it now has is the name it has.
        let again = rename(&h, "Notes/travel", "travel");
        assert_eq!(again["changed"], false, "{again}");
    }

    #[test]
    fn rename_note_takes_no_name_that_is_another_entry_for_the_same_file() {
        let h = Harness::writing("move_alias");
        fs::hard_link(h.path("Notes/Travel.md"), h.path("Notes/Alias.md")).unwrap();
        let refusal = h.refused(
            "rename_note",
            json!({ "ref": "Notes/Travel", "to": "Alias" }),
        );
        assert!(refusal.contains("already exists"), "{refusal}");
        assert!(h.root.join("Notes").join("Travel.md").is_file());

        // That entry's name in other letters reaches it where the filesystem
        // ignores case and is a free name elsewhere, so the answer differs,
        // but the other entry is not replaced either way.
        let other_case = json!({ "ref": "Notes/Travel", "to": "alias" });
        let _ = h.call("rename_note", other_case);
        assert!(listed(&h, "Notes").contains(&"Alias.md".to_string()));
    }

    #[test]
    fn rename_note_keeps_the_extension_and_takes_one_name_only() {
        let h = Harness::writing("move_names");
        let named = rename(&h, "Notes/Travel", "Trip.md");
        assert_eq!(h.relative(&named["path"]), "Notes/Trip.md");
        // A dot in the name is not an extension to swap the note's for.
        let dotted = rename(&h, "Notes/Trip", "Trip v1.2");
        assert_eq!(h.relative(&dotted["path"]), "Notes/Trip v1.2.md");
        // A board stays a board, and the embed of it follows.
        let board = rename(&h, "Board.canvas", "Map");
        assert_eq!(h.relative(&board["path"]), "Map.canvas");
        assert!(h.read("Index.md").contains("![[Map]]"));

        // Refused as a name, before anything is asked of the disk.
        for to in ["", "  ", ".", "..", "a/b", "a\\b", "x:y", "what?"] {
            let refusal = h.refused("rename_note", json!({ "ref": "Index", "to": to }));
            assert!(refusal.contains("is not a file name"), "{to:?}: {refusal}");
        }
        let hidden = h.refused("rename_note", json!({ "ref": "Index", "to": ".hidden" }));
        assert!(hidden.contains("does not index"), "{hidden}");
        assert!(h.root.join("Index.md").is_file());
    }

    #[test]
    fn a_destination_that_exists_is_never_replaced() {
        let h = Harness::writing("move_collision");
        let (travel, cooking) = (h.read("Notes/Travel.md"), h.read("Notes/Cooking.md"));
        let index = h.read("Index.md");

        let taken = h.refused(
            "rename_note",
            json!({ "ref": "Notes/Travel", "to": "Cooking" }),
        );
        assert!(taken.contains("already exists"), "{taken}");
        // Archive holds its own Travel.
        let taken = h.refused(
            "move_note",
            json!({ "ref": "Notes/Travel", "to": "Archive" }),
        );
        assert!(taken.contains("already exists"), "{taken}");

        assert_eq!(h.read("Notes/Travel.md"), travel);
        assert_eq!(h.read("Notes/Cooking.md"), cooking);
        assert_eq!(
            h.read("Archive/Travel.md"),
            fs::read_to_string(fixture("Archive/Travel.md")).unwrap()
        );
        assert_eq!(h.read("Index.md"), index);

        // Its own name, or its own folder, is nothing to do.
        assert_eq!(rename(&h, "Notes/Travel", "Travel")["changed"], false);
        let stayed = h.ok("move_note", json!({ "ref": "Notes/Travel", "to": "Notes" }));
        assert_eq!(stayed["changed"], false);
        assert_eq!(h.relative(&stayed["path"]), "Notes/Travel.md");
    }

    fn fixture(note: &str) -> std::path::PathBuf {
        crate::vault::test_support::fixtures_dir()
            .join("vault")
            .join(note)
    }

    #[test]
    fn move_note_moves_into_a_folder_the_index_reads() {
        let h = Harness::writing("move_folders");
        let moved = h.ok("move_note", json!({ "ref": "Cooking", "to": "Archive" }));
        assert_eq!(h.relative(&moved["path"]), "Archive/Cooking.md");
        // The card names the file by path, so it follows; the wikilink still
        // reaches the only Cooking there is, and stays as written.
        assert_eq!(relinked(&h, &moved), ["Board.canvas"]);
        assert!(h
            .read("Board.canvas")
            .contains("\"file\": \"Archive/Cooking.md\""));
        assert!(h.read("Index.md").contains("[[Cooking]]"));

        let up = h.ok("move_note", json!({ "ref": "Archive/Cooking", "to": "." }));
        assert_eq!(h.relative(&up["path"]), "Cooking.md");

        fs::create_dir_all(h.root.join(".obsidian")).unwrap();
        fs::create_dir_all(h.root.join("node_modules")).unwrap();
        for (to, why) in [
            ("", "is empty"),
            ("  ", "is empty"),
            ("Missing", "not a folder"),
            ("Index.md", "not a folder"),
            (".obsidian", "does not index"),
            ("node_modules", "does not index"),
        ] {
            let refusal = h.refused("move_note", json!({ "ref": "Cooking", "to": to }));
            assert!(refusal.contains(why), "{to}: {refusal}");
        }
        assert!(h.root.join("Cooking.md").is_file());
    }

    #[test]
    fn move_note_learns_nothing_about_a_folder_outside_the_grants() {
        let h = Harness::writing("move_probe");
        let outside = crate::vault::test_support::unique_tmp("move_probe_outside");
        let there = outside.to_string_lossy().to_string();
        let missing = outside.join("missing").to_string_lossy().to_string();
        // The same refusal whether or not the folder exists.
        for to in [&there, &missing] {
            let refusal = h.refused("move_note", json!({ "ref": "Index", "to": to }));
            assert!(
                refusal.starts_with("path is outside the allowed"),
                "{refusal}"
            );
        }
        #[cfg(windows)]
        for to in [
            "\\\\attacker.invalid\\share",
            "\\\\?\\UNC\\attacker.invalid\\share",
        ] {
            let refusal = h.refused("move_note", json!({ "ref": "Index", "to": to }));
            assert!(refusal.contains("never looked up"), "{refusal}");
        }
        fs::remove_dir_all(&outside).unwrap();
    }

    #[test]
    fn a_note_open_in_a_window_is_not_moved_from_under_it() {
        let mut h = Harness::writing("move_open");
        // Open and saved is enough: the tab would keep the old path.
        h.editing(&["Notes/Travel.md"], &[]);
        for (tool, to) in [("rename_note", "Trip"), ("move_note", ".")] {
            let refusal = h.refused(tool, json!({ "ref": "Notes/Travel", "to": to }));
            assert!(refusal.starts_with(OPEN), "{tool}: {refusal}");
        }

        // A note whose links would be rewritten holds unsaved edits.
        h.editing(&["Index.md"], &["Index.md"]);
        let index = h.read("Index.md");
        let refusal = h.refused(
            "rename_note",
            json!({ "ref": "Notes/Travel", "to": "Trip" }),
        );
        assert!(refusal.starts_with(UNSAVED), "{refusal}");
        assert!(refusal.contains("Index.md"), "{refusal}");
        // Refused before anything moved.
        assert!(h.root.join("Notes").join("Travel.md").is_file());
        assert_eq!(h.read("Index.md"), index);

        // Saved, it is rewritten on disk and the window reloads it.
        h.editing(&["Index.md"], &[]);
        assert_eq!(rename(&h, "Notes/Travel", "Trip")["changed"], true);
    }

    #[test]
    fn a_rewrite_that_stops_midway_says_where_and_keeps_what_it_wrote() {
        let h = Harness::writing("move_partial");
        let locked = h.path("Index.md");
        let index = h.read("Index.md");
        let writable = fs::metadata(&locked).unwrap().permissions();
        let mut read_only = writable.clone();
        read_only.set_readonly(true);
        fs::set_permissions(&locked, read_only).unwrap();

        let result = rename(&h, "Cooking", "Baking");
        fs::set_permissions(&locked, writable).unwrap();

        assert_eq!(result["changed"], true);
        assert_eq!(h.relative(&result["path"]), "Notes/Baking.md");
        assert_eq!(relinked(&h, &result), ["Board.canvas"]);
        assert!(h.read("Board.canvas").contains("Notes/Baking.md"));
        assert_eq!(h.relative(&result["failed"]["path"]), "Index.md");
        assert_eq!(h.read("Index.md"), index);
        let summary = result["summary"].as_str().unwrap();
        assert!(summary.contains("The rewrite stopped at"), "{summary}");
    }
}
