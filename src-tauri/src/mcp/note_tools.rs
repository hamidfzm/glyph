//! Tools that answer about one note: where a target leads, and the note's
//! text and structure.

use std::path::Path;

use serde::Deserialize;
use serde_json::{json, Value};

use super::refs::{
    capped, cut_text, link_target, note_path, note_schema, read_text, read_vault, ref_property,
    resolve_note, vault_property, NoteArgs,
};
use super::registry::{arguments, Effect, Session, ToolDef};
use crate::vault::{
    js_lines, parse_frontmatter, parse_headings, section, slug, split_frontmatter, split_heading,
    Frontmatter,
};

pub(super) const RESOLVE_LINK: ToolDef = ToolDef {
    name: "resolve_link",
    title: "Resolve a wikilink",
    description: "Where a wikilink target leads, resolved the way Glyph resolves it: the name case-insensitively with or without `.md`, a path suffix when the target has a folder, `aliases:` as the last resort, and the linking note's folder breaking a tie. Returns the note and the heading the target names, how it matched, which rule broke a tie, and the other notes it could have meant.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": {
                    "type": "string",
                    "description": "The target as written in a link, such as `Note`, `Folder/Note#Heading` or `[[Note|alias]]`."
                },
                "from": {
                    "type": "string",
                    "description": "Path of the note the link is in. Among notes sharing a name, the one in its folder wins."
                },
                "vault": vault_property()
            },
            "required": ["ref"],
            "additionalProperties": false
        })
    },
    effect: Effect::ReadOnly,
    enabled: true,
    handler: resolve_link,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ResolveLinkArgs {
    #[serde(rename = "ref")]
    target: String,
    from: Option<String>,
    vault: Option<String>,
}

fn resolve_link(session: &Session, args: Value) -> Result<Value, String> {
    let args: ResolveLinkArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let from = match &args.from {
            Some(from) => Some(
                note_path(session, vault, root, from)?
                    .ok_or_else(|| format!("from must be a note in {root}, not {from:?}"))?,
            ),
            None => None,
        };
        let target = link_target(&args.target);
        let resolution = vault.resolve_link(target, from.as_deref()).map(|found| {
            json!({
                "path": found.path,
                "matchedBy": found.matched_by,
                "tieBreak": found.tie_break,
                "candidates": capped(found.candidates.into_iter()),
            })
        });
        Ok(json!({
            "target": target,
            "heading": split_heading(target).1,
            "resolution": resolution,
        }))
    })
}

pub(super) const READ_NOTE: ToolDef = ToolDef {
    name: "read_note",
    title: "Read a note",
    description: "A note found by wikilink target or path: its frontmatter parsed with the renderer's rules (every value stays the string the note shows), and its body, or only the section under one heading, sliced the way embeds slice it. A heading in the reference (`Note#Heading`) picks the section too.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "section": {
                    "type": "string",
                    "description": "A heading's text or its slug. The section runs to the next heading of the same or a higher level."
                },
                "vault": vault_property()
            },
            "required": ["ref"],
            "additionalProperties": false
        })
    },
    effect: Effect::ReadOnly,
    enabled: true,
    handler: read_note,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ReadNoteArgs {
    #[serde(rename = "ref")]
    note: String,
    section: Option<String>,
    vault: Option<String>,
}

fn read_note(session: &Session, args: Value) -> Result<Value, String> {
    let args: ReadNoteArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        let content = read_text(session, &found.path)?;
        let (block, body_start) = split_frontmatter(&content);
        let frontmatter = block
            .as_deref()
            .and_then(parse_frontmatter)
            .map(frontmatter_json);
        let wanted = args.section.or(found.heading);
        let body = match &wanted {
            Some(heading) => section(&content, body_start, heading)
                .ok_or_else(|| missing_section(&content, body_start, heading, &found.path))?,
            None => js_lines(&content)
                .skip(body_start)
                .collect::<Vec<_>>()
                .join("\n"),
        };
        let (text, cut) = cut_text(&body);
        Ok(json!({
            "path": found.path,
            "frontmatter": frontmatter,
            "section": wanted,
            "content": text,
            "cut": cut,
            "totalChars": body.chars().count(),
        }))
    })
}

fn frontmatter_json(frontmatter: Frontmatter) -> Value {
    let fields: serde_json::Map<String, Value> = frontmatter
        .extra
        .into_iter()
        .map(|(key, value)| (key, Value::String(value)))
        .collect();
    json!({
        "title": frontmatter.title,
        "author": frontmatter.author,
        "date": frontmatter.date,
        "tags": frontmatter.tags,
        "aliases": frontmatter.aliases,
        "fields": fields,
    })
}

/// No heading matched, so say which ones exist for the model to pick from.
fn missing_section(content: &str, body_start: usize, heading: &str, path: &str) -> String {
    let known: Vec<String> = parse_headings(content, body_start)
        .into_iter()
        .take(50)
        .map(|found| found.text.chars().take(100).collect::<String>())
        .collect();
    format!("no heading in {path} matches {heading:?}; its headings are: {known:?}")
}

pub(super) const NOTE_INFO: ToolDef = ToolDef {
    name: "note_info",
    title: "Describe a note",
    description: "A note's structure as Glyph indexes it: title, tags (fence-aware, nested tags normalized), its frontmatter as read_note gives it, headings with their slugs, and every outgoing link with its heading, alias, whether it embeds, and the note it resolves to or null when it is broken.",
    input_schema: note_schema,
    effect: Effect::ReadOnly,
    enabled: true,
    handler: note_info,
};

fn note_info(session: &Session, args: Value) -> Result<Value, String> {
    let args: NoteArgs = arguments(args)?;
    read_vault(session, args.vault.as_deref(), |vault, root| {
        let found = resolve_note(session, vault, root, &args.note)?;
        let note = vault
            .note(&found.path)
            .ok_or_else(|| format!("{} is not indexed", found.path))?;
        // A board is JSON, so it has no frontmatter or headings to parse.
        let (frontmatter, headings) = if crate::is_canvas_file(Path::new(&found.path)) {
            (Value::Null, Vec::new())
        } else {
            let content = read_text(session, &found.path)?;
            let (block, body_start) = split_frontmatter(&content);
            let frontmatter = block
                .as_deref()
                .and_then(parse_frontmatter)
                .map_or(Value::Null, frontmatter_json);
            (frontmatter, parse_headings(&content, body_start))
        };
        let headings = headings.into_iter().map(|heading| {
            json!({
                "level": heading.level,
                "slug": slug(&heading.text),
                "text": heading.text,
                "line": heading.line,
            })
        });
        let links = note.links.iter().map(|link| {
            json!({
                "target": link.target,
                "heading": link.heading,
                "alias": link.alias,
                "embed": link.embed,
                "line": link.line,
                "resolved": vault.resolve_link(&link.target, Some(&found.path)).map(|to| to.path),
            })
        });
        Ok(json!({
            "path": found.path,
            "title": note.title,
            "tags": note.tags,
            "aliases": note.aliases,
            "frontmatter": frontmatter,
            "headings": capped(headings),
            "links": capped(links),
            "status": vault.status(),
        }))
    })
}
