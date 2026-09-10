//! Every tool driven through the registry in-process, against the shared
//! fixture vault: parity with the index the app reads, freshness, the grant
//! boundary, and hostile input.

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Value};

use super::registry::{dispatch, list, Session, ToolError};
use super::session::{OpenState, OpenTab};
use crate::grants::GrantRegistry;
use crate::vault::test_support::{fixture_vault, fixtures_dir, in_vault, relative, unique_tmp};
use crate::vault::{Direction, Vault, VaultStore};

struct Harness {
    root: PathBuf,
    grants: GrantRegistry,
    store: VaultStore,
    open: OpenState,
    exe: PathBuf,
}

impl Harness {
    fn new(name: &str) -> Self {
        Self::over(fixture_vault(name))
    }

    fn over(root: PathBuf) -> Self {
        let grants = GrantRegistry::default();
        grants.grant_workspace(&root).unwrap();
        let open = OpenState {
            roots: vec![root.to_string_lossy().to_string()],
            ..OpenState::default()
        };
        Harness {
            root,
            grants,
            store: VaultStore::default(),
            open,
            // Nothing by this name exists, so a launch fails instead of
            // starting anything.
            exe: PathBuf::from("glyph-tests-start-nothing"),
        }
    }

    fn path(&self, relative: &str) -> String {
        in_vault(&self.root, relative)
    }

    fn call(&self, tool: &str, args: Value) -> Result<Value, ToolError> {
        let session = Session {
            grants: &self.grants,
            vaults: &self.store,
            open: &self.open,
            exe: &self.exe,
        };
        dispatch(tool, args, &session)
    }

    fn ok(&self, tool: &str, args: Value) -> Value {
        self.call(tool, args.clone())
            .unwrap_or_else(|err| panic!("{tool}({args}) failed: {err:?}"))
    }

    fn refused(&self, tool: &str, args: Value) -> String {
        match self.call(tool, args.clone()) {
            Err(ToolError::Failed(message)) => message,
            other => panic!("{tool}({args}) should have refused, got {other:?}"),
        }
    }

    /// A fresh build of the same folder: the answer the app would give.
    fn index(&self) -> Vault {
        Vault::build(&self.root).unwrap()
    }

    fn relative(&self, path: &Value) -> String {
        relative(&self.root, path.as_str().unwrap())
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn items(listing: &Value) -> &Vec<Value> {
    listing["items"].as_array().unwrap()
}

fn fixture(name: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(fixtures_dir().join(name)).unwrap()).unwrap()
}

// ------------------------------------------------------------ the registry

#[test]
fn every_tool_is_listed_with_an_object_schema() {
    let names: Vec<&str> = list().map(|tool| tool.name).collect();
    assert_eq!(
        names,
        [
            "vault_context",
            "resolve_link",
            "read_note",
            "note_info",
            "backlinks",
            "graph_neighbors",
            "vault_report",
            "list_tags",
            "notes_by_tag",
            "read_canvas",
            "open_in_glyph",
            "export",
        ]
    );
    for tool in list() {
        let described = tool.describe();
        assert_eq!(described["inputSchema"]["type"], "object", "{}", tool.name);
        assert_eq!(
            described["inputSchema"]["additionalProperties"], false,
            "{}",
            tool.name
        );
    }
}

#[test]
fn an_unknown_tool_is_not_a_tool_error() {
    let h = Harness::new("mcp_unknown");
    assert_eq!(
        h.call("delete_everything", json!({})),
        Err(ToolError::Unknown("delete_everything".to_string()))
    );
}

// ------------------------------------------------------ parity with the index

#[test]
fn resolve_link_matches_the_resolver() {
    let h = Harness::new("mcp_resolve");
    let index = h.index();
    let cases: [(Option<&str>, &str, Option<&str>); 10] = [
        (None, "cooking", Some("Notes/Cooking.md")),
        (None, "Cooking.MD", Some("Notes/Cooking.md")),
        (None, "Cooking#Recipes", Some("Notes/Cooking.md")),
        (
            None,
            "[[Cooking#Recipes|the recipe section]]",
            Some("Notes/Cooking.md"),
        ),
        (None, "![[Board]]", Some("Board.canvas")),
        (None, "Notes/Travel", Some("Notes/Travel.md")),
        (
            Some("Archive/Travel.md"),
            "Travel",
            Some("Archive/Travel.md"),
        ),
        (Some("Index.md"), "Travel", Some("Notes/Travel.md")),
        (None, "Second Name", Some("Aliased.md")),
        (None, "Missing Note", None),
    ];
    for (from, target, expected) in cases {
        let mut args = json!({ "ref": target });
        if let Some(from) = from {
            args["from"] = json!(h.path(from));
        }
        let result = h.ok("resolve_link", args);
        let got = result["resolution"]["path"].as_str();
        assert_eq!(
            got.map(|path| relative(&h.root, path)).as_deref(),
            expected,
            "{target}"
        );
        // The same answer the app's resolver gives for the same link.
        let from = from.map(|from| h.path(from));
        let bare = result["target"].as_str().unwrap().to_string();
        assert_eq!(got, index.resolve_many(from.as_deref(), &[bare])[0]);
    }

    let result = h.ok(
        "resolve_link",
        json!({ "ref": "Travel#Day one", "from": h.path("Index.md") }),
    );
    assert_eq!(result["heading"], "Day one");
    assert_eq!(result["resolution"]["tieBreak"], "shortestPath");
    assert_eq!(result["resolution"]["matchedBy"], "name");
    let candidates: Vec<String> = result["resolution"]["candidates"]["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|path| h.relative(path))
        .collect();
    assert_eq!(candidates, ["Archive/Travel.md"]);
    assert_eq!(
        h.ok("resolve_link", json!({ "ref": "Third Name" }))["resolution"]["matchedBy"],
        "alias"
    );
}

#[test]
fn read_note_parses_frontmatter_with_the_renderers_rules() {
    let h = Harness::new("mcp_frontmatter");
    for (name, want) in fixture("vault-frontmatter.json").as_object().unwrap() {
        let result = h.ok("read_note", json!({ "ref": name }));
        assert_eq!(h.relative(&result["path"]), *name);
        let got = &result["frontmatter"];
        if want.is_null() {
            assert!(got.is_null(), "{name} has no frontmatter");
            continue;
        }
        for key in ["title", "author", "date"] {
            assert_eq!(
                got[key],
                want.get(key).cloned().unwrap_or(Value::Null),
                "{name}.{key}"
            );
        }
        assert_eq!(got["tags"], want.get("tags").cloned().unwrap_or(json!([])));
        let fields: serde_json::Map<String, Value> = want["extra"]
            .as_array()
            .unwrap()
            .iter()
            .map(|pair| (pair[0].as_str().unwrap().to_string(), pair[1].clone()))
            .collect();
        assert_eq!(got["fields"], Value::Object(fields), "{name}.fields");
    }
    // The body starts after the block, and a scalar stays the text it was.
    let old = h.ok("read_note", json!({ "ref": "Old Note" }));
    assert_eq!(old["frontmatter"]["fields"]["version"], "1.0");
    assert!(old["content"]
        .as_str()
        .unwrap()
        .starts_with("\nA note whose name"));
}

#[test]
fn read_note_slices_sections_the_way_embeds_do() {
    let h = Harness::new("mcp_sections");
    let expected = fixture("vault-headings.json");
    for case in expected["sections"].as_array().unwrap() {
        let heading = case["heading"].as_str().unwrap();
        let args = json!({ "ref": "Notes/Sections.md", "section": heading });
        let want = case["section"].as_str().unwrap();
        if want.is_empty() {
            assert!(
                h.refused("read_note", args).contains("no heading"),
                "{heading}"
            );
        } else {
            assert_eq!(h.ok("read_note", args)["content"], want, "{heading}");
        }
    }
    // A heading in the reference picks the section too.
    let result = h.ok("read_note", json!({ "ref": "Sections#launch--plan" }));
    assert_eq!(result["section"], "launch--plan");
    assert!(result["content"]
        .as_str()
        .unwrap()
        .starts_with("## Launch 🚀 Plan"));
    // A missing one lists what exists, so the model can pick again.
    let refusal = h.refused("read_note", json!({ "ref": "Cooking", "section": "Nope" }));
    assert!(refusal.contains("Recipes"), "{refusal}");
}

#[test]
fn note_info_reports_headings_tags_and_link_detail() {
    let h = Harness::new("mcp_note_info");
    let info = h.ok("note_info", json!({ "ref": "Index" }));
    assert_eq!(info["title"], "Index");
    assert_eq!(info["tags"], json!(["home", "reference"]));
    assert_eq!(info["fields"]["status"], "published");
    assert_eq!(
        items(&info["headings"]),
        &vec![json!({ "level": 1, "slug": "index", "text": "Index", "line": 8 })]
    );

    let links = items(&info["links"]);
    let board = links.iter().find(|link| link["target"] == "Board").unwrap();
    assert_eq!(board["embed"], true);
    assert_eq!(h.relative(&board["resolved"]), "Board.canvas");
    let recipe = links.iter().find(|link| !link["alias"].is_null()).unwrap();
    assert_eq!(recipe["heading"], "Recipes");
    assert_eq!(recipe["alias"], "the recipe section");
    assert_eq!(recipe["embed"], false);
    let broken = links
        .iter()
        .find(|link| link["target"] == "Missing Note")
        .unwrap();
    assert!(broken["resolved"].is_null(), "a broken link is flagged");

    // Fenced code holds neither headings nor tags nor links.
    let cooking = h.ok("note_info", json!({ "ref": "Cooking" }));
    assert_eq!(cooking["tags"], json!(["food", "food/baking", "kitchen"]));
    let texts: Vec<&Value> = items(&cooking["headings"])
        .iter()
        .map(|h| &h["text"])
        .collect();
    assert_eq!(texts, [&json!("Cooking"), &json!("Recipes")]);
    assert!(items(&cooking["links"])
        .iter()
        .all(|link| link["target"] != "NotALink"));
    // A board has no markdown headings, only the cards it links.
    let board = h.ok("note_info", json!({ "ref": "Board.canvas" }));
    assert!(items(&board["headings"]).is_empty());
    assert_eq!(items(&board["links"])[0]["heading"], "Recipes");
}

#[test]
fn backlinks_agree_with_the_backlinks_panel() {
    let h = Harness::new("mcp_backlinks");
    let index = h.index();
    for path in index.snapshot().files {
        let result = h.ok("backlinks", json!({ "ref": path }));
        assert_eq!(
            Value::Array(items(&result["backlinks"]).clone()),
            serde_json::to_value(index.backlinks(path)).unwrap(),
            "{path}"
        );
    }
    let cooking = h.ok("backlinks", json!({ "ref": "Cooking" }));
    assert_eq!(cooking["backlinks"]["total"], 3);
    assert_eq!(cooking["status"]["truncated"], false);
}

#[test]
fn graph_neighbors_agree_with_the_graph_view_and_walk_further() {
    let h = Harness::new("mcp_neighbors");
    let index = h.index();
    for path in index.snapshot().files {
        let result = h.ok("graph_neighbors", json!({ "ref": path }));
        let want: Vec<Value> = index
            .neighbors(path, 1, Direction::Both)
            .into_iter()
            .map(|(path, hops)| json!({ "path": path, "hops": hops }))
            .collect();
        assert_eq!(items(&result["neighbors"]), &want, "{path}");
    }
    let inward = h.ok(
        "graph_neighbors",
        json!({ "ref": "Aliased", "depth": 2, "direction": "in" }),
    );
    let walked: Vec<(String, u64)> = items(&inward["neighbors"])
        .iter()
        .map(|n| (h.relative(&n["path"]), n["hops"].as_u64().unwrap()))
        .collect();
    assert_eq!(
        walked,
        [
            ("Index.md".to_string(), 1),
            ("Notes/Cooking.md".to_string(), 2),
            ("Notes/Travel.md".to_string(), 2)
        ]
    );
    let outward = h.ok(
        "graph_neighbors",
        json!({ "ref": "Aliased", "direction": "out" }),
    );
    assert!(items(&outward["neighbors"]).is_empty());
    assert!(h
        .refused("graph_neighbors", json!({ "ref": "Aliased", "depth": 0 }))
        .contains("at least 1"));
    assert!(h
        .refused(
            "graph_neighbors",
            json!({ "ref": "Aliased", "direction": "sideways" })
        )
        .contains("invalid arguments"));
}

#[test]
fn vault_report_lists_what_the_index_derives() {
    let h = Harness::new("mcp_report");
    let index = h.index();
    let snapshot = index.snapshot();
    let report = h.ok("vault_report", json!({}));

    assert_eq!(
        Value::Array(items(&report["unresolved"]).clone()),
        serde_json::to_value(snapshot.unresolved).unwrap()
    );
    assert_eq!(
        Value::Array(items(&report["deadEnds"]).clone()),
        serde_json::to_value(snapshot.dead_ends).unwrap()
    );
    let orphans: Vec<&str> = snapshot
        .graph
        .nodes
        .iter()
        .filter(|node| node.orphan)
        .map(|node| node.id.as_str())
        .collect();
    assert_eq!(
        items(&report["orphans"]),
        &json!(orphans).as_array().unwrap().clone()
    );
    assert!(items(&report["orphans"])
        .iter()
        .any(|path| h.relative(path) == "Broken.md"));
}

#[test]
fn list_tags_and_notes_by_tag_follow_the_tag_rules() {
    let h = Harness::new("mcp_tags");
    // A scalar `tags:` is two tags; written after the first index was built,
    // so the call also has to see a file that appeared meanwhile.
    h.ok("list_tags", json!({}));
    fs::write(
        h.root.join("Scalar.md"),
        "---\ntags: work, ideas\n---\nbody\n",
    )
    .unwrap();

    let result = h.ok("list_tags", json!({}));
    let tags: Vec<(String, u64)> = items(&result["tags"])
        .iter()
        .map(|t| {
            (
                t["tag"].as_str().unwrap().to_string(),
                t["count"].as_u64().unwrap(),
            )
        })
        .collect();
    let has = |name: &str| tags.iter().any(|(tag, _)| tag == name);
    for kept in [
        "food",
        "food/baking",
        "kitchen",
        "archive",
        "archive/old",
        "work",
        "ideas",
    ] {
        assert!(has(kept), "{kept} is a tag: {tags:?}");
    }
    // Fenced code, an issue reference, and a hash inside a word are not tags.
    for dropped in ["notatag", "42", "word"] {
        assert!(!has(dropped), "{dropped} is not a tag: {tags:?}");
    }
    assert_eq!(
        Value::Array(items(&result["tags"]).clone()),
        serde_json::to_value(h.index().snapshot().tag_counts).unwrap()
    );

    let food = h.ok("notes_by_tag", json!({ "tag": "#Food" }));
    let notes: Vec<String> = items(&food["notes"])
        .iter()
        .map(|p| h.relative(p))
        .collect();
    assert_eq!(notes, ["Notes/Cooking.md"]);
    let archive = h.ok("notes_by_tag", json!({ "tag": "archive" }));
    assert_eq!(
        h.relative(&items(&archive["notes"])[0]),
        "Archive/Old Note.md"
    );
}

#[test]
fn read_canvas_returns_the_board() {
    let h = Harness::new("mcp_canvas");
    let board = h.ok("read_canvas", json!({ "path": "Board.canvas" }));
    assert_eq!(board["nodes"]["total"], 4);
    assert_eq!(board["edges"]["total"], 1);
    assert_eq!(items(&board["edges"])[0]["label"], "explains");
    // A board's name resolves like a note's.
    assert_eq!(
        h.ok("read_canvas", json!({ "path": "Board" }))["nodes"]["total"],
        4
    );
    assert!(h
        .refused("read_canvas", json!({ "path": "Index.md" }))
        .contains("not a canvas"));
}

// --------------------------------------------------------------- freshness

#[test]
fn a_change_on_disk_is_in_the_next_call() {
    let h = Harness::new("mcp_fresh");
    assert_eq!(
        h.ok("backlinks", json!({ "ref": "Aliased" }))["backlinks"]["total"],
        1
    );

    let added = h.root.join("Notes").join("Fresh.md");
    fs::write(&added, "Points at [[Aliased]] #fresh\n").unwrap();
    assert_eq!(
        h.ok("backlinks", json!({ "ref": "Aliased" }))["backlinks"]["total"],
        2
    );
    assert_eq!(
        h.ok("notes_by_tag", json!({ "tag": "fresh" }))["notes"]["total"],
        1
    );

    fs::write(&added, "Now it points at nothing #stale\n").unwrap();
    assert_eq!(
        h.ok("backlinks", json!({ "ref": "Aliased" }))["backlinks"]["total"],
        1
    );
    assert_eq!(
        h.ok("read_note", json!({ "ref": "Fresh" }))["content"],
        "Now it points at nothing #stale"
    );

    fs::remove_file(&added).unwrap();
    assert!(h
        .refused("read_note", json!({ "ref": "Fresh" }))
        .contains("no note"));
    assert_eq!(
        h.ok("notes_by_tag", json!({ "tag": "stale" }))["notes"]["total"],
        0
    );
}

#[test]
fn a_vault_deleted_mid_session_is_an_error_not_a_crash() {
    let h = Harness::new("mcp_deleted");
    h.ok("list_tags", json!({}));
    fs::remove_dir_all(&h.root).unwrap();
    assert!(h
        .refused("list_tags", json!({}))
        .contains("no longer exists"));
    let context = h.ok("vault_context", json!({}));
    let error = context["vaults"][0]["error"].as_str().unwrap();
    assert!(error.contains("no longer exists"), "{error}");
}

// ------------------------------------------------------------- live state

#[test]
fn vault_context_reports_what_is_open_while_the_app_runs() {
    let mut h = Harness::new("mcp_context");
    h.open.app_running = true;
    h.open.active_note = Some(h.path("Index.md"));
    h.open.tabs = vec![OpenTab {
        kind: "file".to_string(),
        path: h.path("Index.md"),
    }];

    let context = h.ok("vault_context", json!(null));
    assert_eq!(context["appRunning"], true);
    assert_eq!(context["activeNote"], json!(h.path("Index.md")));
    assert_eq!(context["openTabs"]["total"], 1);
    assert_eq!(context["vaults"][0]["status"]["truncated"], false);
    assert!(context.get("note").is_none());
    // The active note's vault is the default for every other tool.
    assert_eq!(
        h.ok("note_info", json!({ "ref": "Index" }))["title"],
        "Index"
    );
}

#[test]
fn vault_context_says_plainly_when_nothing_is_open() {
    let h = Harness::new("mcp_context_closed");
    let context = h.ok("vault_context", json!({}));
    assert_eq!(context["appRunning"], false);
    assert!(context["activeNote"].is_null());
    assert!(context["note"].as_str().unwrap().contains("not running"));

    let mut empty = Harness::over(unique_tmp("mcp_no_vault"));
    empty.open.roots.clear();
    let context = empty.ok("vault_context", json!({}));
    assert!(context["note"].as_str().unwrap().contains("No vault"));
    assert!(empty
        .refused("list_tags", json!({}))
        .contains("no vault is open"));
}

#[test]
fn several_vaults_need_the_caller_to_pick_one() {
    let mut h = Harness::new("mcp_two_vaults");
    let second = unique_tmp("mcp_second_vault");
    fs::write(second.join("Only.md"), "#other\n").unwrap();
    h.grants.grant_workspace(&second).unwrap();
    h.open.roots.push(second.to_string_lossy().to_string());

    assert!(h.refused("list_tags", json!({})).contains("several vaults"));
    let other = h.ok(
        "notes_by_tag",
        json!({ "tag": "other", "vault": second.to_string_lossy() }),
    );
    assert_eq!(other["notes"]["total"], 1);
    fs::remove_dir_all(&second).unwrap();
}

// ------------------------------------------------------- the grant boundary

#[test]
fn a_path_outside_the_vault_is_refused_by_every_tool() {
    let h = Harness::new("mcp_outside");
    let outside = unique_tmp("mcp_outside_target");
    let secret = outside.join("Secret.md");
    fs::write(&secret, "classified [[Index]]\n").unwrap();
    let secret = secret.to_string_lossy().to_string();

    let refusals = [
        h.refused("read_note", json!({ "ref": secret })),
        h.refused("note_info", json!({ "ref": secret })),
        h.refused("backlinks", json!({ "ref": secret })),
        h.refused("graph_neighbors", json!({ "ref": secret })),
        h.refused("read_canvas", json!({ "path": secret })),
        h.refused("open_in_glyph", json!({ "ref": secret })),
        h.refused("export", json!({ "ref": secret, "format": "pdf" })),
        h.refused("resolve_link", json!({ "ref": "Index", "from": secret })),
        h.refused("read_note", json!({ "ref": "Index", "vault": outside.to_string_lossy() })),
        h.refused("list_tags", json!({ "vault": outside.to_string_lossy() })),
        h.refused("read_note", json!({ "ref": "../mcp_outside_target/Secret.md" })),
        h.refused(
            "export",
            json!({ "ref": "Index", "format": "pdf", "out": outside.join("out.pdf").to_string_lossy() }),
        ),
    ];
    for refusal in &refusals {
        assert!(!refusal.contains("classified"), "leaked content: {refusal}");
        assert!(!refusal.is_empty());
    }
    assert!(refusals[0].starts_with("path is outside the allowed workspaces and files"));
    assert!(refusals[8].contains("not an open vault"));
    fs::remove_dir_all(&outside).unwrap();
}

#[cfg(unix)]
#[test]
fn a_symlink_out_of_the_vault_is_refused() {
    let h = Harness::new("mcp_symlink");
    let outside = unique_tmp("mcp_symlink_target");
    fs::write(outside.join("Secret.md"), "classified\n").unwrap();
    std::os::unix::fs::symlink(outside.join("Secret.md"), h.root.join("Innocent.md")).unwrap();
    std::os::unix::fs::symlink(&outside, h.root.join("linked")).unwrap();

    for reference in ["Innocent.md", "Innocent", "linked/Secret.md", "Secret"] {
        let refusal = h.refused("read_note", json!({ "ref": reference }));
        assert!(!refusal.contains("classified"), "{reference}: {refusal}");
    }
    fs::remove_dir_all(&outside).unwrap();
}

#[cfg(windows)]
#[test]
fn a_junction_out_of_the_vault_is_refused() {
    let h = Harness::new("mcp_junction");
    let outside = unique_tmp("mcp_junction_target");
    fs::write(outside.join("Secret.md"), "classified\n").unwrap();
    let output = std::process::Command::new("cmd")
        .arg("/C")
        .arg("mklink")
        .arg("/J")
        .arg(h.root.join("linked"))
        .arg(&outside)
        .output()
        .unwrap();
    assert!(output.status.success(), "mklink /J failed");

    for reference in ["linked/Secret.md", "linked\\Secret.md", "Secret"] {
        let refusal = h.refused("read_note", json!({ "ref": reference }));
        assert!(!refusal.contains("classified"), "{reference}: {refusal}");
    }
    fs::remove_dir_all(&outside).unwrap();
}

// ------------------------------------------------------------ hostile input

#[test]
fn malformed_arguments_are_refused_with_a_reason() {
    let h = Harness::new("mcp_malformed");
    for (tool, args) in [
        ("read_note", json!({ "ref": 42 })),
        ("read_note", json!({})),
        ("read_note", json!(null)),
        ("read_note", json!({ "ref": "Index", "sneaky": true })),
        ("read_note", json!(["Index"])),
        ("graph_neighbors", json!({ "ref": "Index", "depth": -1 })),
        ("graph_neighbors", json!({ "ref": "Index", "depth": "two" })),
        ("vault_context", json!({ "extra": 1 })),
        ("export", json!({ "ref": "Index" })),
    ] {
        let refusal = h.refused(tool, args.clone());
        assert!(
            refusal.starts_with("invalid arguments"),
            "{tool}({args}): {refusal}"
        );
    }
    assert!(h
        .refused("read_note", json!({ "ref": "   " }))
        .contains("empty"));
}

#[test]
fn hostile_notes_are_bounded_and_never_crash_a_call() {
    let h = Harness::new("mcp_hostile");
    fs::write(
        h.root.join("Nested.md"),
        format!(
            "---\nkey: {}{}\n---\nbody\n",
            // Past the parser's depth cap, and small enough to stay a block.
            "[".repeat(200),
            "]".repeat(200)
        ),
    )
    .unwrap();
    fs::write(
        h.root.join("Huge.md"),
        "x".repeat(crate::commands::walk::SCAN_MAX_FILE_BYTES as usize + 1),
    )
    .unwrap();

    let nested = h.ok("read_note", json!({ "ref": "Nested" }));
    assert!(
        nested["frontmatter"].is_null(),
        "a hostile block is not parsed"
    );
    assert_eq!(nested["content"], "body");
    let huge = h.refused("read_note", json!({ "ref": "Huge.md" }));
    assert!(huge.contains("5 MB"), "{huge}");
}

#[test]
fn long_results_are_cut_and_say_so() {
    let root = unique_tmp("mcp_long");
    fs::write(root.join("Hub.md"), "y".repeat(60_000)).unwrap();
    for i in 0..250 {
        fs::write(root.join(format!("n{i:03}.md")), "[[Hub]]\n").unwrap();
    }
    let h = Harness::over(root);

    let backlinks = h.ok("backlinks", json!({ "ref": "Hub" }));
    assert_eq!(backlinks["backlinks"]["total"], 250);
    assert_eq!(backlinks["backlinks"]["cut"], true);
    assert_eq!(items(&backlinks["backlinks"]).len(), super::refs::MAX_ITEMS);

    let note = h.ok("read_note", json!({ "ref": "Hub" }));
    assert_eq!(note["cut"], true);
    assert_eq!(note["totalChars"], 60_000);
    assert_eq!(
        note["content"].as_str().unwrap().chars().count(),
        super::refs::MAX_TEXT_CHARS
    );
    assert_eq!(
        h.ok("read_note", json!({ "ref": "n000" }))["cut"],
        false,
        "a short note is whole"
    );
}

// ------------------------------------------------------------- launching

#[test]
fn export_refuses_a_target_it_must_not_write() {
    let h = Harness::new("mcp_export_rules");
    for (args, reason) in [
        (
            json!({ "ref": "Index", "format": "site" }),
            "format must be",
        ),
        (
            json!({ "ref": "Index", "format": "pdf", "out": "Index.md" }),
            "must end in .pdf",
        ),
        (
            json!({ "ref": "Index", "format": "html", "out": "out.pdf" }),
            "must end in .html",
        ),
        (
            json!({ "ref": "Board", "format": "pdf" }),
            "not a markdown note",
        ),
    ] {
        let refusal = h.refused("export", args.clone());
        assert!(refusal.contains(reason), "{args}: {refusal}");
    }
    // Nothing was written, and the note is intact.
    assert!(fs::read_to_string(h.root.join("Index.md"))
        .unwrap()
        .contains("The hub."));
}

#[test]
fn a_launch_that_cannot_start_says_so() {
    if cfg!(target_os = "macos") {
        // macOS goes through LaunchServices, which would open the real app.
        return;
    }
    let h = Harness::new("mcp_launch_missing");
    assert!(h
        .refused("open_in_glyph", json!({ "ref": "Index" }))
        .contains("cannot start Glyph"));
    assert!(h
        .refused("export", json!({ "ref": "Index", "format": "pdf" }))
        .contains("cannot run glyph export"));
}

#[cfg(all(unix, not(target_os = "macos")))]
#[test]
fn launches_hand_the_note_to_the_child_and_pass_its_failure_through() {
    use std::os::unix::fs::PermissionsExt;

    let mut h = Harness::new("mcp_launch");
    let index = h.path("Index.md");

    h.exe = PathBuf::from("true");
    assert_eq!(
        h.ok("open_in_glyph", json!({ "ref": "Index" }))["opened"],
        json!(index)
    );

    // A stand-in for `glyph` that records the command line it was given.
    let bin = unique_tmp("mcp_recorder");
    let recorder = bin.join("glyph");
    let log = bin.join("args.txt");
    fs::write(
        &recorder,
        format!("#!/bin/sh\necho \"$@\" > '{}'\n", log.display()),
    )
    .unwrap();
    fs::set_permissions(&recorder, fs::Permissions::from_mode(0o755)).unwrap();
    h.exe = recorder;

    // Without `out` the file goes beside the note, where the command line puts it.
    let beside = h.path("Index.pdf");
    let exported = h.ok("export", json!({ "ref": "Index", "format": "pdf" }));
    assert_eq!(exported["path"], json!(beside));
    assert_eq!(
        fs::read_to_string(&log).unwrap().trim(),
        format!("export {index} --format pdf --out {beside}")
    );
    let named = h.path("copy.html");
    let exported = h.ok(
        "export",
        json!({ "ref": "Index", "format": "html", "out": "copy.html" }),
    );
    assert_eq!(exported["path"], json!(named));
    assert_eq!(
        fs::read_to_string(&log).unwrap().trim(),
        format!("export {index} --format html --out {named}")
    );

    h.exe = PathBuf::from("false");
    assert!(h
        .refused("export", json!({ "ref": "Index", "format": "pdf" }))
        .contains("failed"));
    // A failing child's stderr is passed through as it is.
    h.exe = PathBuf::from("sh");
    let refusal = h.refused("export", json!({ "ref": "Index", "format": "docx" }));
    assert!(refusal.contains("export"), "{refusal}");
    fs::remove_dir_all(&bin).unwrap();
}

// --------------------------------------------------------------- the server

#[test]
fn the_whole_server_answers_over_any_stream() {
    let root = fixture_vault("mcp_serve");
    let input = format!(
        "{}\n{}\n",
        json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": "2025-11-25" } }),
        json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "vault_report", "arguments": {} } }),
    );
    let mut output = Vec::new();
    let vaults = vec![root.to_string_lossy().to_string()];
    assert_eq!(super::serve_with(vaults, input.as_bytes(), &mut output), 0);

    let replies: Vec<Value> = String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect();
    assert_eq!(replies.len(), 2);
    let text = replies[1]["result"]["content"][0]["text"].as_str().unwrap();
    let report: Value = serde_json::from_str(text).unwrap();
    assert_eq!(report["unresolved"]["total"], 3);
    fs::remove_dir_all(&root).unwrap();
}

/// A client whose end of the pipe refuses every write with one kind of error.
struct Refusing(std::io::ErrorKind);

impl std::io::Write for Refusing {
    fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
        Err(self.0.into())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[test]
fn an_appimage_launches_itself_rather_than_its_mounted_binary() {
    let appimage = std::ffi::OsString::from("/home/me/Glyph.AppImage");
    assert_eq!(
        super::launcher(Some(appimage)),
        PathBuf::from("/home/me/Glyph.AppImage")
    );
    assert_eq!(super::launcher(None), std::env::current_exe().unwrap());
}

#[test]
fn a_client_that_goes_away_ends_the_session_cleanly() {
    let ping = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";
    let gone = Refusing(std::io::ErrorKind::BrokenPipe);
    assert_eq!(super::serve_with(Vec::new(), ping.as_bytes(), gone), 0);
    let broken = Refusing(std::io::ErrorKind::PermissionDenied);
    assert_eq!(super::serve_with(Vec::new(), ping.as_bytes(), broken), 1);
}

#[test]
fn the_vault_of_the_note_in_front_of_the_user_is_the_default() {
    let mut h = Harness::new("mcp_active_vault");
    let second = unique_tmp("mcp_active_second");
    fs::write(second.join("Only.md"), "#other\n").unwrap();
    h.grants.grant_workspace(&second).unwrap();
    h.open.roots.push(second.to_string_lossy().to_string());
    h.open.active_note = Some(second.join("Only.md").to_string_lossy().to_string());

    let tags = h.ok("list_tags", json!({}));
    assert_eq!(tags["vault"], json!(second.to_string_lossy()));
    // A path in the other vault is refused until `vault` picks that one.
    let elsewhere = h.path("Index.md");
    assert!(h
        .refused("read_note", json!({ "ref": elsewhere }))
        .contains("is not in the vault"));
    let read = h.ok(
        "read_note",
        json!({ "ref": elsewhere, "vault": h.root.to_string_lossy() }),
    );
    assert_eq!(read["frontmatter"]["title"], "Index");
    fs::remove_dir_all(&second).unwrap();
}

#[test]
fn a_folder_is_not_a_note() {
    let h = Harness::new("mcp_folder_ref");
    let folder = h.path("Notes");
    assert!(h
        .refused("read_note", json!({ "ref": folder }))
        .contains("is not a file"));
}

#[test]
fn export_stays_inside_the_vault_it_reads_whatever_else_is_granted() {
    let h = Harness::new("mcp_export_scope");
    // Granted, the way a workspace closed in the app stays granted, but not
    // one this session serves.
    let other = unique_tmp("mcp_export_other");
    h.grants.grant_workspace(&other).unwrap();
    let out = other.join("index.html");
    let refusal = h.refused(
        "export",
        json!({ "ref": "Index", "format": "html", "out": out.to_string_lossy() }),
    );
    assert!(refusal.contains("inside the vault"), "{refusal}");
    assert!(!out.exists());
    fs::remove_dir_all(&other).unwrap();
}
