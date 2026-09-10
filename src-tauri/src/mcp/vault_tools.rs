//! Tools that answer about a whole vault: what is open, what is broken, and
//! how it is tagged.

use serde::Deserialize;
use serde_json::{json, Value};

use super::refs::{capped, read_vault, vault_property};
use super::registry::{arguments, Effect, Session, ToolDef};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VaultArgs {
    vault: Option<String>,
}

fn vault_schema() -> Value {
    json!({
        "type": "object",
        "properties": { "vault": vault_property() },
        "additionalProperties": false
    })
}

pub(super) const VAULT_CONTEXT: ToolDef = ToolDef {
    name: "vault_context",
    title: "What is open",
    description: "The vaults this server reads and whether each index is complete, and, when Glyph is running, the note in front of the user, the open tabs and the expanded folders. None of this is in any file an agent would read. Call it first.",
    input_schema: || json!({ "type": "object", "properties": {}, "additionalProperties": false }),
    effect: Effect::ReadOnly,
    enabled: true,
    handler: vault_context,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NoArgs {}

fn vault_context(session: &Session, args: Value) -> Result<Value, String> {
    let _: NoArgs = arguments(args)?;
    let open = session.open;
    let vaults: Vec<Value> = open
        .roots
        .iter()
        .map(
            |root| match read_vault(session, Some(root), |vault, _| Ok(vault.status())) {
                Ok(status) => json!({ "root": root, "status": status }),
                Err(err) => json!({ "root": root, "error": err }),
            },
        )
        .collect();
    let mut context = json!({
        "appRunning": open.app_running,
        "vaults": vaults,
        "activeNote": open.active_note,
        "openTabs": capped(open.tabs.iter()),
        "expandedFolders": open.expanded,
    });
    if open.roots.is_empty() {
        context["note"] =
            json!("No vault: start the server with --vault <folder>, or open a folder in Glyph.");
    } else if !open.app_running {
        context["note"] = json!(
            "Glyph is not running, so nothing is open in it. The vault tools still read the vaults listed."
        );
    }
    Ok(context)
}

pub(super) const VAULT_REPORT: ToolDef = ToolDef {
    name: "vault_report",
    title: "Vault health",
    description: "What the resolved link graph says is wrong or loose: links that resolve to nothing (source, target, line), orphans that nothing links to and that link nowhere, and dead ends that link nowhere.",
    input_schema: vault_schema,
    effect: Effect::ReadOnly,
    enabled: true,
    handler: vault_report,
};

fn vault_report(session: &Session, args: Value) -> Result<Value, String> {
    let args: VaultArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let snapshot = vault.snapshot();
        let orphans: Vec<&str> = snapshot
            .graph
            .nodes
            .iter()
            .filter(|node| node.orphan)
            .map(|node| node.id.as_str())
            .collect();
        Ok(json!({
            "vault": root,
            "unresolved": capped(snapshot.unresolved.iter()),
            "orphans": capped(orphans.into_iter()),
            "deadEnds": capped(snapshot.dead_ends.iter()),
            "status": snapshot.status,
        }))
    })
}

pub(super) const LIST_TAGS: ToolDef = ToolDef {
    name: "list_tags",
    title: "Tags",
    description: "Every tag with the number of notes carrying it, most used first. A nested tag counts toward its parents (`work/urgent` counts for `work`). Tags follow Glyph's rules: none inside fenced code, `issue #42` and `mid#word` are not tags, and `tags: a, b` is two.",
    input_schema: vault_schema,
    effect: Effect::ReadOnly,
    enabled: true,
    handler: list_tags,
};

fn list_tags(session: &Session, args: Value) -> Result<Value, String> {
    let args: VaultArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let snapshot = vault.snapshot();
        Ok(json!({
            "vault": root,
            "tags": capped(snapshot.tag_counts.iter()),
            "status": snapshot.status,
        }))
    })
}

pub(super) const NOTES_BY_TAG: ToolDef = ToolDef {
    name: "notes_by_tag",
    title: "Notes with a tag",
    description: "The notes carrying a tag or one of its nested tags, matched the way Glyph normalizes tags (case-insensitive, `#` optional).",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "tag": { "type": "string", "description": "Such as `work` or `#work/urgent`." },
                "vault": vault_property()
            },
            "required": ["tag"],
            "additionalProperties": false
        })
    },
    effect: Effect::ReadOnly,
    enabled: true,
    handler: notes_by_tag,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TagArgs {
    tag: String,
    vault: Option<String>,
}

fn notes_by_tag(session: &Session, args: Value) -> Result<Value, String> {
    let args: TagArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, _| {
        Ok(json!({
            "tag": args.tag,
            "notes": capped(vault.paths_with_tag(&args.tag).into_iter()),
            "status": vault.status(),
        }))
    })
}
