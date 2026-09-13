//! Tests that span the vault's siblings or drive its command surface. The
//! per-sibling rules live in each sibling's own test module.

use std::fs;
use std::path::Path;

use serde_json::{json, Value};
use tauri::Manager;

use super::commands::*;
use super::frontmatter::{parse_frontmatter, split_frontmatter};
use super::headings::{parse_headings, section, slug};
use super::index::strip_bom;
use super::resolve::{MatchedBy, TieBreak};
use super::test_support::*;
use super::{apply_changes, forget, Direction, Vault, VaultStore};
use crate::grants::GrantRegistry;

fn build(root: &Path) -> Vault {
    Vault::build(root).unwrap()
}

fn resolve_one(vault: &Vault, from: Option<&str>, target: &str) -> Option<String> {
    vault.resolve_many(from, &[target.to_string()])[0].map(str::to_string)
}

// ---------------------------------------------------------------- the index

#[test]
fn the_fixture_vault_indexes_markdown_and_canvas() {
    let root = fixture_vault("index_all");
    let vault = build(&root);
    let snapshot = vault.snapshot();
    let files: Vec<String> = snapshot
        .files
        .iter()
        .map(|path| relative(&root, path))
        .collect();

    assert_eq!(
        files,
        vec![
            "Aliased.md",
            "Archive/Old Note.md",
            "Archive/Travel.md",
            "Board.canvas",
            "Broken.md",
            "Index.md",
            "Notes/Cooking.md",
            "Notes/Sections.md",
            "Notes/Travel.md",
        ]
    );
    assert!(!snapshot.status.truncated);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn resolution_across_the_fixture_vault() {
    let root = fixture_vault("resolve");
    let vault = build(&root);
    let index = in_vault(&root, "Index.md");
    let archive = in_vault(&root, "Archive/Travel.md");

    let cases: [(Option<&str>, &str, Option<&str>); 8] = [
        // Case-insensitive stem, `.md` stripped, heading and alias ignored.
        (None, "cooking", Some("Notes/Cooking.md")),
        (None, "Cooking.MD", Some("Notes/Cooking.md")),
        (None, "Cooking#Recipes", Some("Notes/Cooking.md")),
        // A nested target matches a path suffix.
        (None, "Notes/Travel", Some("Notes/Travel.md")),
        // Colliding stems: the linking file's own directory wins, otherwise
        // the shortest path does.
        (Some(archive.as_str()), "Travel", Some("Archive/Travel.md")),
        (Some(index.as_str()), "Travel", Some("Notes/Travel.md")),
        // An alias resolves once nothing is named that.
        (None, "Second Name", Some("Aliased.md")),
        (None, "Missing Note", None),
    ];

    for (from, target, expected) in cases {
        let got = resolve_one(&vault, from, target).map(|p| relative(&root, &p));
        assert_eq!(got.as_deref(), expected, "resolving {target}");
    }
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn tags_follow_the_documented_rules() {
    let root = fixture_vault("tags");
    let vault = build(&root);
    let snapshot = vault.snapshot();

    let cooking = snapshot
        .notes
        .iter()
        .find(|note| note.path.ends_with("Cooking.md"))
        .expect("Cooking is indexed");
    // Frontmatter list plus the inline tag; the fenced tag, the issue
    // reference and the mid-word hash contribute nothing.
    assert_eq!(cooking.tags, vec!["food", "food/baking", "kitchen"]);

    // A nested tag counts toward each ancestor, once per file.
    let counts: Vec<(&str, usize)> = snapshot
        .tag_counts
        .iter()
        .map(|c| (c.tag.as_str(), c.count))
        .collect();
    assert!(counts.contains(&("food", 1)));
    assert!(counts.contains(&("food/baking", 1)));
    assert!(counts.contains(&("archive", 1)));

    let with_food: Vec<String> = vault
        .paths_with_tag("food")
        .into_iter()
        .map(|p| relative(&root, p))
        .collect();
    assert_eq!(with_food, vec!["Notes/Cooking.md"]);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn frontmatter_matches_the_shared_expectation() {
    // The same file drives `src/lib/frontmatter.test.ts`. When one parser
    // changes, that test and this one disagree with it together.
    let expected: Value = serde_json::from_str(
        &fs::read_to_string(fixtures_dir().join("vault-frontmatter.json")).unwrap(),
    )
    .unwrap();
    let vault_dir = fixtures_dir().join("vault");
    // The BOM case: an editor that drops the invisible mark drops the coverage.
    let aliased = fs::read_to_string(vault_dir.join("Aliased.md")).unwrap();
    assert!(aliased.starts_with('\u{feff}'), "Aliased.md lost its BOM");

    for (name, want) in expected.as_object().unwrap() {
        let content = fs::read_to_string(vault_dir.join(name)).unwrap();
        let parsed = split_frontmatter(strip_bom(&content))
            .0
            .as_deref()
            .and_then(parse_frontmatter);

        let Some(want) = want.as_object() else {
            assert!(parsed.is_none(), "{name} should carry no frontmatter");
            continue;
        };
        let parsed = parsed.unwrap_or_else(|| panic!("{name} should parse"));

        for key in ["title", "author", "date"] {
            let got = match key {
                "title" => &parsed.title,
                "author" => &parsed.author,
                _ => &parsed.date,
            };
            assert_eq!(
                got.as_deref(),
                want.get(key).and_then(Value::as_str),
                "{name}.{key}"
            );
        }
        let want_tags: Vec<&str> = want
            .get("tags")
            .and_then(Value::as_array)
            .map(|v| v.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        assert_eq!(parsed.tags, want_tags, "{name}.tags");

        let got_extra: Vec<Value> = parsed.extra.iter().map(|(k, v)| json!([k, v])).collect();
        assert_eq!(&Value::Array(got_extra), &want["extra"], "{name}.extra");
    }
}

#[test]
fn headings_match_the_shared_expectation() {
    // The same file drives `markdownHeadings.test.ts` and
    // `headingSection.test.ts`, so the section rule cannot drift between the
    // renderer's embeds and `read_note`.
    let expected: Value = serde_json::from_str(
        &fs::read_to_string(fixtures_dir().join("vault-headings.json")).unwrap(),
    )
    .unwrap();
    let note = expected["note"].as_str().unwrap();
    let content = fs::read_to_string(fixtures_dir().join("vault").join(note)).unwrap();

    let headings = serde_json::to_value(parse_headings(&content, 0)).unwrap();
    assert_eq!(headings, expected["headings"]);

    for case in expected["sections"].as_array().unwrap() {
        let heading = case["heading"].as_str().unwrap();
        let got = section(&content, 0, heading).unwrap_or_default();
        assert_eq!(
            got,
            case["section"].as_str().unwrap(),
            "section {heading:?}"
        );
    }
    for case in expected["slugs"].as_array().unwrap() {
        let text = case["text"].as_str().unwrap();
        assert_eq!(slug(text), case["slug"].as_str().unwrap(), "slug {text:?}");
    }
}

#[test]
fn the_graph_and_backlinks_read_from_resolved_links() {
    let root = fixture_vault("graph");
    let vault = build(&root);
    let snapshot = vault.snapshot();

    // Index links Cooking twice (plain and with a heading); one edge only.
    let index_edges: Vec<String> = snapshot
        .graph
        .edges
        .iter()
        .filter(|e| e.source.ends_with("Index.md"))
        .map(|e| relative(&root, &e.target))
        .collect();
    assert_eq!(
        index_edges,
        vec![
            "Notes/Cooking.md",
            "Notes/Travel.md",
            "Aliased.md",
            "Board.canvas"
        ]
    );

    // Broken.md points nowhere, so it is an orphan and a dead end.
    let broken = snapshot
        .graph
        .nodes
        .iter()
        .find(|n| n.id.ends_with("Broken.md"))
        .unwrap();
    assert_eq!(broken.degree, 0);
    assert!(broken.orphan);
    assert!(snapshot.dead_ends.iter().any(|p| p.ends_with("Broken.md")));
    assert_eq!(
        snapshot
            .unresolved
            .iter()
            .filter(|u| u.source.ends_with("Broken.md"))
            .count(),
        2
    );

    // One row per source line: Index links Cooking on two lines, the board on
    // one, and the two links sharing Index's second line collapse into it.
    let backlinks = vault.backlinks(&in_vault(&root, "Notes/Cooking.md"));
    assert_eq!(backlinks.len(), 3);
    assert!(backlinks
        .iter()
        .all(|b| b.source.ends_with("Index.md") || b.source.ends_with("Board.canvas")));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_canvas_board_is_indexed_and_links_its_file_cards() {
    let root = fixture_vault("canvas");
    let vault = build(&root);
    let board = in_vault(&root, "Board.canvas");

    let canvas = vault.canvas(&board).expect("the board is indexed");
    // The card without geometry is dropped, and so is the edge to a card that
    // does not exist.
    assert_eq!(canvas.nodes.len(), 4);
    assert_eq!(canvas.edges.len(), 1);

    let neighbors: Vec<String> = vault
        .neighbors(&board, 1, Direction::Both)
        .into_iter()
        .map(|(p, _)| relative(&root, p))
        .collect();
    assert_eq!(neighbors, vec!["Index.md", "Notes/Cooking.md"]);
    fs::remove_dir_all(&root).unwrap();
}

/// Editing a board re-reads it in place, the way a note edit does.
#[test]
fn editing_a_canvas_updates_its_board_and_links() {
    let root = fixture_vault("canvas-edit");
    let mut vault = build(&root);
    let board = in_vault(&root, "Board.canvas");

    fs::write(
        &board,
        r#"{"nodes":[{"id":"a","type":"file","file":"Index.md","x":0,"y":0,"width":100,"height":100}],"edges":[]}"#,
    )
    .unwrap();
    vault.apply_changes(&[std::path::PathBuf::from(&board)]);

    let canvas = vault.canvas(&board).expect("the board stays indexed");
    assert_eq!(canvas.nodes.len(), 1);
    assert!(canvas.edges.is_empty());
    let neighbors: Vec<String> = vault
        .neighbors(&board, 1, Direction::Both)
        .into_iter()
        .map(|(p, _)| relative(&root, p))
        .collect();
    assert_eq!(neighbors, vec!["Index.md"]);
    assert_matches_rebuild(&vault, &root);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn queries_filter_on_tags_and_fields() {
    let root = fixture_vault("query");
    let vault = build(&root);

    let tagged = vault.query("tag:food recipes");
    assert_eq!(tagged.text, "recipes");
    assert_eq!(
        tagged
            .paths
            .iter()
            .map(|p| relative(&root, p))
            .collect::<Vec<_>>(),
        vec!["Notes/Cooking.md"]
    );

    // `project` is a field the fixture uses, so it filters.
    let field = vault.query("project:glyph");
    assert_eq!(
        field
            .paths
            .iter()
            .map(|p| relative(&root, p))
            .collect::<Vec<_>>(),
        vec!["Archive/Old Note.md"]
    );

    // `section` is not, so it stays plain text. With no filter there is
    // nothing to narrow by, and the caller is told so rather than handed the
    // whole workspace.
    let plain = vault.query("Section:Overview");
    assert!(plain.filters.is_empty());
    assert_eq!(plain.text, "Section:Overview");
    assert!(plain.paths.is_empty());
    fs::remove_dir_all(&root).unwrap();
}

// -------------------------------------------------------- incremental updates

/// An incremental update must land the index exactly where a rebuild from disk
/// would, so a long-lived session never drifts from a fresh open.
fn assert_matches_rebuild(vault: &Vault, root: &Path) {
    let fresh = build(root);
    let (a, b) = (vault.snapshot(), fresh.snapshot());
    assert_eq!(
        serde_json::to_value(&a).unwrap(),
        serde_json::to_value(&b).unwrap()
    );
}

#[test]
fn creating_editing_deleting_and_renaming_update_the_index_in_place() {
    let root = fixture_vault("incremental");
    let mut vault = build(&root);

    // Create, reported twice, as a watcher batch may.
    let added = root.join("Notes").join("Added.md");
    fs::write(&added, "---\ntags: [fresh]\n---\n\nLinks [[Index]].\n").unwrap();
    vault.apply_changes(&[added.clone(), added.clone()]);
    assert_eq!(
        resolve_one(&vault, None, "Added").map(|p| relative(&root, &p)),
        Some("Notes/Added.md".to_string())
    );
    assert_eq!(vault.paths_with_tag("fresh").len(), 1);
    assert_matches_rebuild(&vault, &root);

    // Edit: the tag goes, a new outgoing link arrives.
    fs::write(&added, "Now links [[Cooking]] instead.\n").unwrap();
    vault.apply_changes(std::slice::from_ref(&added));
    assert!(vault.paths_with_tag("fresh").is_empty());
    assert!(vault
        .backlinks(&in_vault(&root, "Notes/Cooking.md"))
        .iter()
        .any(|b| b.source.ends_with("Added.md")));
    assert_matches_rebuild(&vault, &root);

    // Rename, which arrives as the two paths that changed.
    let renamed = root.join("Notes").join("Renamed.md");
    fs::rename(&added, &renamed).unwrap();
    vault.apply_changes(&[added.clone(), renamed.clone()]);
    assert_eq!(resolve_one(&vault, None, "Added"), None);
    assert!(resolve_one(&vault, None, "Renamed").is_some());
    assert_matches_rebuild(&vault, &root);

    // Delete.
    fs::remove_file(&renamed).unwrap();
    vault.apply_changes(&[renamed]);
    assert_eq!(resolve_one(&vault, None, "Renamed"), None);
    assert_matches_rebuild(&vault, &root);

    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn changes_outside_the_root_or_to_other_file_types_are_ignored() {
    let root = fixture_vault("ignored_changes");
    let outside = unique_tmp("ignored_outside");
    let stray = outside.join("Elsewhere.md");
    fs::write(&stray, "[[Index]]\n").unwrap();
    let attachment = root.join("photo.png");
    fs::write(&attachment, "not markdown").unwrap();

    let mut vault = build(&root);
    let before = serde_json::to_value(vault.snapshot()).unwrap();
    vault.apply_changes(&[stray, attachment]);
    assert_eq!(serde_json::to_value(vault.snapshot()).unwrap(), before);

    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

#[test]
fn a_watcher_event_against_the_canonical_root_still_lands() {
    // `watch_directory` watches the canonicalized root, so notify reports
    // paths with a verbatim prefix on Windows and with symlinks resolved on
    // macOS. The index is keyed on the caller's spelling of the root, and one
    // file must not arrive under two of them.
    let root = fixture_vault("canonical_event");
    let mut vault = build(&root);
    let canonical = fs::canonicalize(&root).unwrap();

    let added = canonical.join("Notes").join("Watched.md");
    fs::write(&added, "body #watched\n").unwrap();
    vault.apply_changes(&[added]);

    assert_eq!(vault.snapshot().files.len(), 10);
    assert_eq!(vault.paths_with_tag("watched").len(), 1);
    // Spelled the way the rest of the index spells it, so tab paths match.
    assert!(vault
        .snapshot()
        .files
        .iter()
        .all(|path| path.starts_with(&root.to_string_lossy().to_string())));
    assert_matches_rebuild(&vault, &root);

    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn an_incremental_update_honours_every_filter_the_walk_applies() {
    let root = fixture_vault("incremental_filters");
    let mut vault = build(&root);
    let before = serde_json::to_value(vault.snapshot()).unwrap();

    // A hidden file, a note inside a skipped directory, and a file past the
    // size cap: the walk offers none of them, so neither does an update.
    let hidden = root.join(".secret.md");
    fs::write(&hidden, "hidden #private\n").unwrap();
    let skipped = root.join("node_modules").join("pkg");
    fs::create_dir_all(&skipped).unwrap();
    let vendored = skipped.join("README.md");
    fs::write(&vendored, "vendored #noise\n").unwrap();
    let oversized = root.join("huge.md");
    fs::write(
        &oversized,
        "x".repeat(crate::commands::walk::SCAN_MAX_FILE_BYTES as usize + 1),
    )
    .unwrap();

    vault.apply_changes(&[hidden, vendored, oversized]);

    assert_eq!(serde_json::to_value(vault.snapshot()).unwrap(), before);
    assert_matches_rebuild(&vault, &root);
    fs::remove_dir_all(&root).unwrap();
}

// A symlink is a way out of the granted workspace. The walk refuses to follow
// one; an incremental update reads files the walk never offered it, so it has
// to refuse them too or a link planted in a shared vault leaks its target's
// content through tags, fields and backlink snippets.
#[cfg(unix)]
#[test]
fn an_incremental_update_refuses_a_symlinked_note() {
    let root = fixture_vault("incremental_symlink");
    let outside = unique_tmp("incremental_symlink_target");
    let secret = outside.join("secret.md");
    fs::write(&secret, "top secret #classified\n").unwrap();

    let mut vault = build(&root);
    let planted = root.join("leak.md");
    std::os::unix::fs::symlink(&secret, &planted).unwrap();
    vault.apply_changes(&[planted]);

    assert!(vault.paths_with_tag("classified").is_empty());
    assert_eq!(vault.snapshot().files.len(), 9);
    assert_matches_rebuild(&vault, &root);

    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

// The walk refuses a symlink structurally: it never descends into a linked
// directory. `walkable` stats only the leaf, which a link further up the path
// is invisible to, and the watcher follows links, so events for a linked
// directory arrive spelled as if they were inside the workspace.
#[cfg(unix)]
#[test]
fn an_incremental_update_refuses_a_note_under_a_symlinked_directory() {
    let root = fixture_vault("incremental_symlink_dir");
    let outside = unique_tmp("incremental_symlink_dir_target");
    fs::write(outside.join("secret.md"), "top secret #classified\n").unwrap();

    let mut vault = build(&root);
    let linked = root.join("archive");
    std::os::unix::fs::symlink(&outside, &linked).unwrap();
    vault.apply_changes(&[linked.join("secret.md")]);

    assert!(vault.paths_with_tag("classified").is_empty());
    assert_eq!(vault.snapshot().files.len(), 9);
    assert_matches_rebuild(&vault, &root);

    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

#[test]
fn one_workspace_caches_one_index_however_the_root_is_spelled() {
    // The store key cannot be the caller's string: a renderer that asked for
    // `<ws>`, `<ws>/.` and `<ws>/./.` would otherwise cache a full index under
    // each and grow the map without bound.
    let root = fixture_vault("cmd_root_spellings");
    let app = app_with_workspace(&root);
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());
    let base = root.to_string_lossy().to_string();

    for spelling in [base.clone(), format!("{base}/."), format!("{base}/./.")] {
        vault_snapshot(spelling, grants.clone(), store.clone()).unwrap();
    }
    assert_eq!(store.0.lock().unwrap().len(), 1);

    // A directory inside the workspace is readable but is not a workspace, so
    // it gets no index of its own.
    let inside = vault_snapshot(in_vault(&root, "Notes"), grants.clone(), store.clone());
    assert!(inside.is_err());
    assert_eq!(store.0.lock().unwrap().len(), 1);

    vault_forget(base, store.clone()).unwrap();
    assert!(store.0.lock().unwrap().is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn queries_about_a_path_the_index_does_not_hold_answer_empty() {
    let root = fixture_vault("unknown_path_queries");
    let vault = build(&root);
    let stranger = "/elsewhere/secret.md";

    assert!(vault.neighbors(stranger, 1, Direction::Both).is_empty());
    assert!(vault.backlinks(stranger).is_empty());
    assert!(vault.canvas(stranger).is_none());
    // A tag that normalizes to nothing selects nothing rather than everything.
    assert!(vault.paths_with_tag("#").is_empty());
    assert!(vault.paths_with_tag("///").is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn an_incremental_update_respects_the_depth_cap() {
    let root = fixture_vault("incremental_depth");
    let mut vault = Vault::build_capped(&root, 10_000, 1).unwrap();
    let before = serde_json::to_value(vault.snapshot()).unwrap();

    // The walk stopped at the top level, so a note one directory down is not
    // one the walk would have offered.
    let deep = root.join("Notes").join("Deep.md");
    fs::write(&deep, "body #deep\n").unwrap();
    vault.apply_changes(&[deep]);

    assert_eq!(serde_json::to_value(vault.snapshot()).unwrap(), before);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn watcher_changes_tolerate_a_poisoned_store() {
    // The watcher thread has nowhere to report an error, so a poisoned lock
    // leaves the index as it was rather than panicking the callback.
    let root = fixture_vault("cmd_poisoned");
    let app = app_with_workspace(&root);
    let store = app.state::<VaultStore>();
    let path = root.to_string_lossy().to_string();

    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = store.0.lock().unwrap();
        panic!("poison");
    }));

    apply_changes(&store, &path, &[root.join("Index.md")]);
    forget(&store, &path);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn growing_past_the_file_cap_is_reported_rather_than_indexed() {
    let root = fixture_vault("incremental_cap");
    let mut vault = Vault::build_capped(&root, 9, 32).unwrap();
    assert!(!vault.snapshot().status.truncated);

    let added = root.join("Ninth.md");
    fs::write(&added, "one too many\n").unwrap();
    vault.apply_changes(&[added]);

    let snapshot = vault.snapshot();
    assert_eq!(snapshot.files.len(), 9);
    assert!(snapshot.status.truncated);
    assert_eq!(snapshot.status.reason, Some("fileLimit"));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_file_that_vanishes_between_the_event_and_the_read_is_dropped() {
    let root = fixture_vault("vanished");
    let mut vault = build(&root);
    let gone = root.join("Notes").join("Cooking.md");
    fs::remove_file(&gone).unwrap();

    vault.apply_changes(&[gone]);

    assert_eq!(resolve_one(&vault, None, "Cooking"), None);
    assert_eq!(vault.snapshot().files.len(), 8);
    fs::remove_dir_all(&root).unwrap();
}

// -------------------------------------------------------------- caps and abuse

#[test]
fn the_file_cap_truncates_and_says_so() {
    let root = fixture_vault("file_cap");
    let vault = Vault::build_capped(&root, 3, 32).unwrap();
    let snapshot = vault.snapshot();

    assert_eq!(snapshot.files.len(), 3);
    assert!(snapshot.status.truncated);
    assert_eq!(snapshot.status.reason, Some("fileLimit"));
    assert_eq!(snapshot.status.limit, Some(3));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_depth_cap_truncates_and_says_so() {
    let root = fixture_vault("depth_cap");
    let vault = Vault::build_capped(&root, 10_000, 1).unwrap();
    let snapshot = vault.snapshot();

    // Only the top level survives; the reason names the cap that cut it.
    assert!(snapshot.files.iter().all(|p| !p.contains("Notes")));
    assert!(snapshot.status.truncated);
    assert_eq!(snapshot.status.reason, Some("depthLimit"));
    assert_eq!(snapshot.status.limit, Some(1));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn building_a_vault_over_a_file_is_an_error() {
    let root = fixture_vault("not_a_dir");
    let result = Vault::build(&root.join("Index.md"));
    assert!(result.is_err());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn hostile_notes_are_bounded_rather_than_indexed() {
    let root = unique_tmp("hostile");
    // A huge frontmatter block, a deeply nested one, one tag past the
    // character cap, and far more tags than a file may contribute.
    fs::write(
        root.join("huge.md"),
        format!("---\nbig: {}\n---\n\nbody #kept\n", "x".repeat(9000)),
    )
    .unwrap();
    fs::write(
        root.join("nested.md"),
        format!(
            "---\nkey: {}{}\n---\n\nbody\n",
            "[".repeat(200),
            "]".repeat(200)
        ),
    )
    .unwrap();
    let many: String = (0..500).map(|i| format!("#tag{i:04} ")).collect();
    fs::write(
        root.join("many.md"),
        format!("#{} {many}\n", "z".repeat(200)),
    )
    .unwrap();

    let vault = build(&root);
    let snapshot = vault.snapshot();

    let note = |name: &str| {
        snapshot
            .notes
            .iter()
            .find(|n| n.path.ends_with(name))
            .unwrap()
    };
    assert!(note("huge.md").fields.is_empty());
    assert_eq!(note("huge.md").tags, vec!["kept"]);
    assert!(snapshot
        .notes
        .iter()
        .all(|n| !n.path.ends_with("nested.md")));
    assert_eq!(
        note("many.md").tags.len(),
        super::tags::MAX_INLINE_TAGS_PER_FILE
    );
    assert!(note("many.md")
        .tags
        .iter()
        .all(|tag| tag.chars().count() <= super::tags::MAX_TAG_CHARS));

    fs::remove_dir_all(&root).unwrap();
}

// A symlink is a way out of the granted workspace, so the walker must not
// follow it. Unix-only: a symlink on Windows needs elevation or Developer Mode.
#[cfg(unix)]
#[test]
fn symlinked_notes_are_not_indexed() {
    let root = unique_tmp("symlink");
    let outside = unique_tmp("symlink_target");
    fs::write(outside.join("Secret.md"), "secret #private\n").unwrap();
    fs::write(root.join("Real.md"), "body\n").unwrap();
    std::os::unix::fs::symlink(outside.join("Secret.md"), root.join("Linked.md")).unwrap();
    // A loop back onto the root must not hang the walk either.
    std::os::unix::fs::symlink(&root, root.join("loop")).unwrap();

    let vault = build(&root);
    let files: Vec<String> = vault
        .snapshot()
        .files
        .iter()
        .map(|p| relative(&root, p))
        .collect();
    assert_eq!(files, vec!["Real.md"]);

    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

// ------------------------------------------------------------ command surface

#[test]
fn the_snapshot_command_returns_the_index_for_a_granted_root() {
    let root = fixture_vault("cmd_snapshot");
    let app = app_with_workspace(&root);
    let snapshot = vault_snapshot(
        root.to_string_lossy().to_string(),
        app.state::<GrantRegistry>(),
        app.state::<VaultStore>(),
    )
    .unwrap();

    assert_eq!(snapshot["files"].as_array().unwrap().len(), 9);
    assert!(snapshot["graph"]["nodes"].is_array());
    assert_eq!(snapshot["status"]["truncated"], json!(false));
    // camelCase keys reach the frontend, not Rust's snake_case.
    assert!(snapshot.get("tagCounts").is_some());
    assert!(snapshot.get("fieldNames").is_some());
    assert!(snapshot.get("deadEnds").is_some());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn every_path_command_is_denied_without_a_grant() {
    let root = fixture_vault("cmd_denied");
    let app = app_without_grants();
    let path = root.to_string_lossy().to_string();
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());

    let errors: Vec<String> = vec![
        vault_snapshot(path.clone(), grants.clone(), store.clone()).unwrap_err(),
        vault_refresh(path.clone(), grants.clone(), store.clone()).unwrap_err(),
        vault_backlinks(path.clone(), path.clone(), grants.clone(), store.clone()).unwrap_err(),
        vault_resolve(path.clone(), None, vec![], grants.clone(), store.clone()).unwrap_err(),
        vault_query(path.clone(), "tag:x".into(), grants.clone(), store.clone()).unwrap_err(),
        vault_paths_with_tag(path.clone(), "x".into(), grants.clone(), store.clone()).unwrap_err(),
    ];

    for error in &errors {
        assert!(
            error.starts_with("path is outside the allowed workspaces and files:"),
            "unexpected error: {error}"
        );
    }
    // A denied call must not have left an index behind for that root.
    assert!(store.0.lock().unwrap().is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn the_targeted_commands_answer_from_the_cached_index() {
    let root = fixture_vault("cmd_targeted");
    let app = app_with_workspace(&root);
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());
    let path = root.to_string_lossy().to_string();

    let resolved = vault_resolve(
        path.clone(),
        Some(in_vault(&root, "Index.md")),
        vec!["Cooking".into(), "Nowhere".into()],
        grants.clone(),
        store.clone(),
    )
    .unwrap();
    assert!(resolved[0].as_deref().unwrap().ends_with("Cooking.md"));
    assert_eq!(resolved[1], None);

    let backlinks = vault_backlinks(
        path.clone(),
        in_vault(&root, "Notes/Cooking.md"),
        grants.clone(),
        store.clone(),
    )
    .unwrap();
    assert_eq!(backlinks.as_array().unwrap().len(), 3);

    let tagged =
        vault_paths_with_tag(path.clone(), "food".into(), grants.clone(), store.clone()).unwrap();
    assert_eq!(tagged.len(), 1);

    let query = vault_query(
        path.clone(),
        "tag:food recipes".into(),
        grants.clone(),
        store.clone(),
    )
    .unwrap();
    assert_eq!(query["text"], json!("recipes"));
    assert_eq!(query["paths"].as_array().unwrap().len(), 1);
    assert_eq!(query["filters"][0]["field"], json!("tag"));

    // A path that is not indexed answers empty rather than reading the disk.
    let missing = vault_backlinks(path, "/elsewhere/secret.md".into(), grants, store).unwrap();
    assert_eq!(missing, json!([]));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn two_open_roots_keep_separate_indexes() {
    let first = fixture_vault("cmd_root_a");
    let second = unique_tmp("cmd_root_b");
    fs::write(second.join("Only.md"), "body #other\n").unwrap();

    let app = app_with_workspace(&first);
    app.state::<GrantRegistry>()
        .grant_workspace(&second)
        .unwrap();
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());

    let a = vault_snapshot(
        first.to_string_lossy().to_string(),
        grants.clone(),
        store.clone(),
    )
    .unwrap();
    let b = vault_snapshot(
        second.to_string_lossy().to_string(),
        grants.clone(),
        store.clone(),
    )
    .unwrap();

    assert_eq!(a["files"].as_array().unwrap().len(), 9);
    assert_eq!(b["files"].as_array().unwrap().len(), 1);
    assert_eq!(store.0.lock().unwrap().len(), 2);

    // Closing one workspace releases only its index.
    vault_forget(first.to_string_lossy().to_string(), store.clone()).unwrap();
    assert_eq!(store.0.lock().unwrap().len(), 1);

    fs::remove_dir_all(&first).unwrap();
    fs::remove_dir_all(&second).unwrap();
}

#[test]
fn refresh_rebuilds_a_cached_index_from_disk() {
    let root = fixture_vault("cmd_refresh");
    let app = app_with_workspace(&root);
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());
    let path = root.to_string_lossy().to_string();

    vault_snapshot(path.clone(), grants.clone(), store.clone()).unwrap();
    fs::write(root.join("Late.md"), "arrived after the first scan\n").unwrap();

    // The cached index has not seen the new file; a refresh has.
    let cached = vault_snapshot(path.clone(), grants.clone(), store.clone()).unwrap();
    assert_eq!(cached["files"].as_array().unwrap().len(), 9);
    let refreshed = vault_refresh(path.clone(), grants.clone(), store.clone()).unwrap();
    assert_eq!(refreshed["files"].as_array().unwrap().len(), 10);
    let after = vault_snapshot(path, grants, store).unwrap();
    assert_eq!(after["files"].as_array().unwrap().len(), 10);

    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn watcher_changes_reach_the_stored_index() {
    let root = fixture_vault("cmd_watcher");
    let app = app_with_workspace(&root);
    let (grants, store) = (app.state::<GrantRegistry>(), app.state::<VaultStore>());
    let path = root.to_string_lossy().to_string();
    vault_snapshot(path.clone(), grants.clone(), store.clone()).unwrap();

    let added = root.join("Watched.md");
    fs::write(&added, "body #watched\n").unwrap();
    apply_changes(&store, &path, &[added]);

    let snapshot = vault_snapshot(path, grants, store).unwrap();
    assert_eq!(snapshot["files"].as_array().unwrap().len(), 10);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn watcher_changes_for_an_unopened_root_are_a_no_op() {
    let root = fixture_vault("cmd_watcher_unknown");
    let app = app_with_workspace(&root);
    let store = app.state::<VaultStore>();

    apply_changes(&store, "/never/opened", &[root.join("Index.md")]);
    forget(&store, "/never/opened");

    assert!(store.0.lock().unwrap().is_empty());
    fs::remove_dir_all(&root).unwrap();
}

// ------------------------------------------------------------------ timing

/// Reports how long indexing a thousand notes takes. Ignored by default; run
/// with
/// `cargo test -p glyph --lib vault::tests::index_1k_notes_timing -- --ignored --nocapture`.
#[test]
#[ignore = "timing, not a pass/fail assertion"]
fn index_1k_notes_timing() {
    use std::time::Instant;

    let root = unique_tmp("timing");
    for i in 0..1_000 {
        fs::write(
            root.join(format!("note{i:04}.md")),
            format!(
                "---\ntitle: Note {i}\ntags: [bench, bench/group{}]\n---\n\n# Note {i}\n\nLinks [[note{:04}]] and [[note{:04}]] plus #inline{}.\n",
                i % 10,
                (i + 1) % 1_000,
                (i + 500) % 1_000,
                i % 7
            ),
        )
        .unwrap();
    }

    let started = Instant::now();
    let vault = build(&root);
    let new = started.elapsed();

    let started = Instant::now();
    let snapshot = serde_json::to_string(&vault.snapshot()).unwrap();
    let serialized = started.elapsed();

    // The same work split into its phases, to see which one to attack.
    let started = Instant::now();
    let paths: Vec<std::path::PathBuf> =
        crate::commands::walk::workspace_walker(&root, crate::commands::walk::WALK_MAX_DEPTH)
            .filter(|entry| entry.file_type().is_file())
            .map(|entry| entry.into_path())
            .collect();
    let walked = started.elapsed();

    let started = Instant::now();
    let contents: Vec<String> = paths
        .iter()
        .map(|path| fs::read_to_string(path).unwrap())
        .collect();
    let read = started.elapsed();

    let started = Instant::now();
    let notes: Vec<_> = paths
        .iter()
        .zip(&contents)
        .map(|(path, content)| super::note::extract_note(&path.to_string_lossy(), content))
        .collect();
    let extracted = started.elapsed();

    let started = Instant::now();
    let names: Vec<String> = notes.iter().map(|note| note.path.clone()).collect();
    let aliases: Vec<Vec<String>> = notes.iter().map(|note| note.aliases.clone()).collect();
    let resolver = super::resolve::Resolver::build(&names, &aliases);
    let graph = super::graph::build(&notes, &resolver);
    let derived = started.elapsed();
    println!(
        "  walk {walked:?}, read on one thread {read:?}, extract {extracted:?}, resolve+graph {derived:?} ({} edges)",
        graph.edges.len()
    );

    println!(
        "vault build:        {new:?} ({} notes)",
        vault.snapshot().files.len()
    );
    println!(
        "snapshot serialize: {serialized:?} ({} bytes)",
        snapshot.len()
    );

    fs::remove_dir_all(&root).unwrap();
}

/// The build divides the files between threads; however they split, every file
/// must land exactly once. A prime count leaves a short last chunk.
#[test]
fn a_parallel_build_indexes_every_file_once() {
    let root = unique_tmp("parallel");
    for i in 0..37 {
        fs::write(
            root.join(format!("n{i:02}.md")),
            format!("[[n{:02}]]", (i + 1) % 37),
        )
        .unwrap();
    }

    let vault = build(&root);
    assert_eq!(vault.snapshot().files.len(), 37);
    assert_eq!(vault.graph.edges.len(), 37);
    fs::remove_dir_all(&root).unwrap();
}

// ------------------------------------------------------------ sync from disk

#[test]
fn a_sync_catches_the_index_up_with_the_disk() {
    let root = fixture_vault("sync");
    let mut vault = build(&root);

    fs::write(
        root.join("Notes").join("Added.md"),
        "Links [[Index]] #fresh\n",
    )
    .unwrap();
    fs::write(root.join("Index.md"), "# Index\n\nNow only [[Travel]].\n").unwrap();
    fs::remove_file(root.join("Broken.md")).unwrap();
    vault.sync().unwrap();

    assert_eq!(vault.paths_with_tag("fresh").len(), 1);
    assert!(vault
        .backlinks(&in_vault(&root, "Notes/Cooking.md"))
        .iter()
        .all(|b| !b.source.ends_with("Index.md")));
    assert!(vault.note(&in_vault(&root, "Broken.md")).is_none());
    assert_matches_rebuild(&vault, &root);

    // Nothing changed since, so a second sync is a walk and nothing more.
    let before = serde_json::to_value(vault.snapshot()).unwrap();
    vault.sync().unwrap();
    assert_eq!(serde_json::to_value(vault.snapshot()).unwrap(), before);

    // A rename is a path that vanished and one that appeared.
    fs::rename(root.join("Aliased.md"), root.join("Renamed.md")).unwrap();
    vault.sync().unwrap();
    assert!(vault.note(&in_vault(&root, "Aliased.md")).is_none());
    assert_eq!(
        resolve_one(&vault, None, "Second Name")
            .map(|path| relative(&root, &path))
            .as_deref(),
        Some("Renamed.md")
    );
    assert_matches_rebuild(&vault, &root);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_sync_reports_the_cap_the_walk_hit_and_lifts_it_when_room_returns() {
    let root = fixture_vault("sync_cap");
    let mut vault = Vault::build_capped(&root, 9, 32).unwrap();

    // The walk sorts by name, so the new file is the one past the cap.
    fs::write(root.join("Zed.md"), "one too many\n").unwrap();
    vault.sync().unwrap();
    let snapshot = vault.snapshot();
    assert!(snapshot.status.truncated);
    assert_eq!(snapshot.files.len(), 9);

    fs::remove_file(root.join("Broken.md")).unwrap();
    vault.sync().unwrap();
    let snapshot = vault.snapshot();
    assert!(!snapshot.status.truncated);
    assert!(snapshot.files.iter().any(|path| path.ends_with("Zed.md")));
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_file_that_displaces_the_last_walked_note_is_not_mistaken_for_it() {
    let root = fixture_vault("sync_cap_displaced");
    let mut vault = Vault::build_capped(&root, 9, 32).unwrap();
    let last = root.join("Notes").join("Travel.md");
    let last_key = last.to_string_lossy().to_string();

    // Sorts first, so the capped walk no longer reaches the last note.
    fs::write(
        root.join("A0.md"),
        "first
",
    )
    .unwrap();
    vault.sync().unwrap();
    assert!(vault.snapshot().status.truncated);
    assert!(
        vault.note(&last_key).is_some(),
        "still on disk, still indexed"
    );

    fs::remove_file(&last).unwrap();
    vault.sync().unwrap();
    let snapshot = vault.snapshot();
    assert!(!snapshot.status.truncated);
    assert!(snapshot.files.iter().any(|path| path.ends_with("A0.md")));
    assert!(
        vault.note(&last_key).is_none(),
        "gone from disk, gone from the index"
    );
    assert_matches_rebuild(&vault, &root);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_same_length_edit_the_clock_cannot_tell_apart_is_still_read() {
    let root = fixture_vault("sync_same_stamp");
    let path = root.join("Same.md");
    fs::write(
        &path, "#todo
",
    )
    .unwrap();
    let mut vault = build(&root);
    let saved_at = fs::metadata(&path).unwrap().modified().unwrap();

    // Same length, same modified time: only the bytes differ.
    fs::write(
        &path, "#done
",
    )
    .unwrap();
    fs::File::options()
        .write(true)
        .open(&path)
        .unwrap()
        .set_modified(saved_at)
        .unwrap();
    vault.sync().unwrap();
    assert_eq!(vault.paths_with_tag("done").len(), 1);
    assert_matches_rebuild(&vault, &root);
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn a_sync_over_a_deleted_root_is_an_error_not_an_empty_vault() {
    let root = fixture_vault("sync_gone");
    let mut vault = build(&root);
    fs::remove_dir_all(&root).unwrap();
    assert!(vault.sync().is_err());
}

// ------------------------------------------------------ neighbours and links

#[test]
fn depth_one_in_both_directions_is_the_graph_view() {
    let root = fixture_vault("neighbors_graph_view");
    let vault = build(&root);
    let snapshot = vault.snapshot();

    for node in snapshot.graph.nodes {
        let mut from_edges: Vec<&str> = snapshot
            .graph
            .edges
            .iter()
            .filter_map(|edge| {
                if edge.source == node.id {
                    Some(edge.target.as_str())
                } else if edge.target == node.id {
                    Some(edge.source.as_str())
                } else {
                    None
                }
            })
            .collect();
        from_edges.sort_unstable();
        from_edges.dedup();
        let mut around: Vec<&str> = vault
            .neighbors(&node.id, 1, Direction::Both)
            .into_iter()
            .map(|(path, _)| path)
            .collect();
        around.sort_unstable();
        assert_eq!(around, from_edges, "{}", node.id);
        assert_eq!(around.len(), node.degree, "{}", node.id);
    }
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn neighbors_honour_depth_and_direction() {
    let root = fixture_vault("neighbors_depth");
    let vault = build(&root);
    let around = |path: &str, depth: u32, direction: Direction| -> Vec<(String, u32)> {
        vault
            .neighbors(&in_vault(&root, path), depth, direction)
            .into_iter()
            .map(|(p, hops)| (relative(&root, p), hops))
            .collect()
    };
    let hops = |pairs: &[(&str, u32)]| -> Vec<(String, u32)> {
        pairs.iter().map(|&(p, h)| (p.to_string(), h)).collect()
    };

    // Only Index links Aliased, and Aliased links nothing.
    assert!(around("Aliased.md", 1, Direction::Out).is_empty());
    assert_eq!(
        around("Aliased.md", 1, Direction::In),
        hops(&[("Index.md", 1)])
    );
    assert_eq!(
        around("Aliased.md", 2, Direction::In),
        hops(&[
            ("Index.md", 1),
            ("Notes/Cooking.md", 2),
            ("Notes/Travel.md", 2)
        ])
    );
    assert_eq!(
        around("Aliased.md", 2, Direction::Both),
        hops(&[
            ("Index.md", 1),
            ("Board.canvas", 2),
            ("Notes/Cooking.md", 2),
            ("Notes/Travel.md", 2)
        ])
    );
    // Cycles do not repeat a note, and depth past the graph's reach is fine.
    let far = around("Index.md", 50, Direction::Both);
    let mut names: Vec<&str> = far.iter().map(|(p, _)| p.as_str()).collect();
    names.dedup();
    assert_eq!(names.len(), far.len());
    assert!(around("Index.md", 0, Direction::Both).is_empty());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn resolve_link_explains_ambiguity_across_the_fixture_vault() {
    let root = fixture_vault("resolve_link");
    let vault = build(&root);
    let index = in_vault(&root, "Index.md");
    let archive = in_vault(&root, "Archive/Travel.md");

    let found = vault.resolve_link("Travel", Some(&index)).unwrap();
    assert_eq!(relative(&root, found.path), "Notes/Travel.md");
    assert_eq!(found.tie_break, Some(TieBreak::ShortestPath));
    assert_eq!(
        found
            .candidates
            .iter()
            .map(|p| relative(&root, p))
            .collect::<Vec<_>>(),
        ["Archive/Travel.md"]
    );

    let found = vault.resolve_link("travel#Top", Some(&archive)).unwrap();
    assert_eq!(relative(&root, found.path), "Archive/Travel.md");
    assert_eq!(found.tie_break, Some(TieBreak::SameDirectory));
    assert_eq!(found.matched_by, MatchedBy::Name);

    let found = vault.resolve_link("Third Name", None).unwrap();
    assert_eq!(relative(&root, found.path), "Aliased.md");
    assert_eq!(found.matched_by, MatchedBy::Alias);
    assert!(vault.resolve_link("Missing Note", None).is_none());
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn link_detail_survives_indexing() {
    let root = fixture_vault("link_detail");
    let vault = build(&root);
    let index = vault.note(&in_vault(&root, "Index.md")).unwrap();

    let embed = index.links.iter().find(|l| l.target == "Board").unwrap();
    assert!(embed.embed);
    let aliased = index.links.iter().find(|l| l.alias.is_some()).unwrap();
    assert_eq!(aliased.target, "Cooking");
    assert_eq!(aliased.heading.as_deref(), Some("Recipes"));
    assert_eq!(aliased.alias.as_deref(), Some("the recipe section"));
    assert!(!aliased.embed);

    // Cooking's fenced `[[NotALink]]` is code, not a link.
    let cooking = vault.note(&in_vault(&root, "Notes/Cooking.md")).unwrap();
    assert!(cooking.links.iter().all(|l| l.target != "NotALink"));
    // A board's file card carries its subpath as the heading.
    let board = vault.note(&in_vault(&root, "Board.canvas")).unwrap();
    assert_eq!(board.links[0].heading.as_deref(), Some("Recipes"));
    fs::remove_dir_all(&root).unwrap();
}
