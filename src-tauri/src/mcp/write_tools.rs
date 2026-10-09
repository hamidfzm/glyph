//! Tools that change one note's text, each through the parser that reads it:
//! a section by its heading, a property in the frontmatter, a task's checkbox.

use serde::Deserialize;
use serde_json::{json, Value};

use super::edits::{edit_note, Outcome};
use super::note_tools::missing_section;
use super::refs::{ref_property, vault_property};
use super::registry::{arguments, Effect, Session, ToolDef};
use crate::vault::{
    js_lines, line_ending, parse_tasks, section_spans, set_property as set_in_frontmatter,
    split_frontmatter, task_text, uncertain_line, NewValue, Scalar, SectionSpan, Task,
};

/// Text as a summary quotes it: a result past the size cap is reported as a
/// failure, and by then the note is written.
fn short(text: &str) -> String {
    text.chars().take(100).collect()
}

pub(super) const PATCH_NOTE: ToolDef = ToolDef {
    name: "patch_note",
    title: "Change a section",
    description: "Replace, append to or prepend to the body under one heading, leaving every byte outside it untouched. The section is the one read_note returns: the heading down to the next heading of the same or a higher level, subsections included. The heading line itself stays, so links to it keep working, and the blank lines around the body stay. The edit is worked out against the note as it is on disk now, not as it was when it was read. `content` goes in as given: start it with an empty line to open a new paragraph. Refused while the note holds unsaved changes in Glyph.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "section": {
                    "type": "string",
                    "description": "A heading's text or its slug. It must name one heading; `Note#Heading` in `ref` works too."
                },
                "content": {
                    "type": "string",
                    "description": "The markdown to put under the heading, without the heading line. Empty with `replace` empties the section."
                },
                "mode": { "type": "string", "enum": ["replace", "append", "prepend"] },
                "vault": vault_property()
            },
            "required": ["ref", "content", "mode"],
            "additionalProperties": false
        })
    },
    effect: Effect::Edits,
    handler: patch_note,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchArgs {
    #[serde(rename = "ref")]
    note: String,
    section: Option<String>,
    content: String,
    mode: Mode,
    vault: Option<String>,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
enum Mode {
    Replace,
    Append,
    Prepend,
}

fn patch_note(session: &Session, args: Value) -> Result<Value, String> {
    let args: PatchArgs = arguments(args)?;
    edit_note(session, args.vault.as_deref(), &args.note, |text, found| {
        let wanted = args.section.as_deref().or(found.heading.as_deref()).ok_or(
            "name the section: pass `section`, or a heading in `ref` such as `Note#Heading`",
        )?;
        let (_, body_start) = split_frontmatter(text);
        let mut spans = section_spans(text, body_start, wanted);
        let span = match spans.len() {
            0 => return Err(missing_section(text, body_start, wanted, &found.path)),
            1 => spans.remove(0),
            several => {
                let lines: Vec<u32> = spans.iter().map(|span| span.heading.line).collect();
                return Err(format!(
                    "{several} headings in {} match {wanted:?}, on lines {lines:?}; patch_note needs a name only one of them has",
                    found.path
                ));
            }
        };
        if let Some(line) = uncertain_line(text, body_start, &span) {
            return Err(format!(
                "where the section {wanted:?} of {} begins and ends is not certain: line {line} is a heading to only one of the two ways the note is read (underlined or indented, or beside code fences that nest). Nothing was written.",
                found.path
            ));
        }
        Ok(patch(text, &span, &args.content, args.mode))
    })
}

fn patch(text: &str, span: &SectionSpan, content: &str, mode: Mode) -> Outcome {
    let eol = line_ending(text);
    let added: Vec<&str> = js_lines(content).collect();
    let (start, end) = match mode {
        Mode::Replace => (span.body.start, span.body.end),
        Mode::Prepend => (span.body.start, span.body.start),
        Mode::Append => (span.body.end, span.body.end),
    };
    let mut edited = String::with_capacity(text.len() + content.len() + eol.len());
    edited.push_str(&text[..start]);
    // The heading, or the body's last line, may end the note unterminated.
    let unterminated = !(edited.is_empty() || edited.ends_with(['\n', '\r']));
    if unterminated && !added.is_empty() {
        edited.push_str(eol);
    }
    for line in &added {
        edited.push_str(line);
        edited.push_str(eol);
    }
    edited.push_str(&text[end..]);

    let heading = format!(
        "{:?} (line {})",
        short(&span.heading.text),
        span.heading.line
    );
    if edited == text {
        return Outcome {
            text: None,
            summary: format!("The section {heading} already reads that way; nothing changed"),
        };
    }
    let summary = match mode {
        Mode::Replace => format!(
            "Replaced the {} lines under {heading} with {}",
            js_lines(&text[start..end]).count(),
            added.len()
        ),
        Mode::Append => format!("Appended {} lines to the section {heading}", added.len()),
        Mode::Prepend => format!("Prepended {} lines to the section {heading}", added.len()),
    };
    Outcome {
        text: Some(edited),
        summary,
    }
}

pub(super) const SET_PROPERTY: ToolDef = ToolDef {
    name: "set_property",
    title: "Set a property",
    description: "Set or remove one frontmatter property, rewriting only that property's own lines: key order, comments, and the quoting of every other value stay exactly as written. A string that YAML would read as another type (`true`, `007`, `null`) is quoted, a value keeps the quote style it had, and a list written one item per line stays that way. A note without frontmatter gets a block. The result is parsed again before it is written, and refused if any other property would read differently. Refused while the note holds unsaved changes in Glyph.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "key": { "type": "string", "description": "The property's name, as written in the note." },
                "value": {
                    "type": ["string", "number", "boolean", "array", "null"],
                    "items": { "type": ["string", "number", "boolean"] },
                    "description": "The new value. `null` removes the property; an empty string is a value."
                },
                "vault": vault_property()
            },
            "required": ["ref", "key", "value"],
            "additionalProperties": false
        })
    },
    effect: Effect::Edits,
    handler: set_property,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PropertyArgs {
    #[serde(rename = "ref")]
    note: String,
    key: String,
    value: Value,
    vault: Option<String>,
}

fn set_property(session: &Session, args: Value) -> Result<Value, String> {
    let args: PropertyArgs = arguments(args)?;
    let key = args.key.as_str();
    if key.trim().is_empty() {
        return Err("key is empty".to_string());
    }
    let named = short(key);
    let value = new_value(&args.value)?;
    edit_note(session, args.vault.as_deref(), &args.note, |text, found| {
        let path = &found.path;
        let Some(edit) = set_in_frontmatter(text, key, value.as_ref())? else {
            let summary = match value {
                Some(_) => format!("{named:?} in {path} already holds that value; nothing changed"),
                None => format!("{path} has no property {named:?}; nothing changed"),
            };
            return Ok(Outcome {
                text: None,
                summary,
            });
        };
        let summary = match (&value, edit.existed) {
            (Some(_), true) => format!("Changed the property {named:?}"),
            (Some(_), false) => format!("Added the property {named:?}"),
            (None, _) => format!("Removed the property {named:?}"),
        };
        Ok(Outcome {
            text: Some(edit.content),
            summary,
        })
    })
}

/// The value to write, or `None` to remove the property.
fn new_value(value: &Value) -> Result<Option<NewValue>, String> {
    let scalar = |value: &Value| {
        match value {
        Value::String(text) => Ok(Scalar::Text(text.clone())),
        Value::Number(_) | Value::Bool(_) => Ok(Scalar::Bare(value.to_string())),
        _ => Err(
            "value must be a string, a number, a boolean, a list of those, or null to remove the property"
                .to_string(),
        ),
    }
    };
    match value {
        Value::Null => Ok(None),
        Value::Array(items) => {
            let items = items.iter().map(scalar).collect::<Result<_, _>>()?;
            Ok(Some(NewValue::List(items)))
        }
        one => Ok(Some(NewValue::Scalar(scalar(one)?))),
    }
}

pub(super) const UPDATE_TASK: ToolDef = ToolDef {
    name: "update_task",
    title: "Check or uncheck a task",
    description: "Mark one task list item done or to do, changing only the character between its brackets. A task is what a click on a checkbox in Glyph toggles: a `-`, `*` or `+` item opening with `[ ]`, `[x]` or `[X]`. A line that only looks like one, inside fenced code or a quote, is not a task. The task is named by its text; when several tasks share it, the refusal lists their lines and `line` picks one. Refused while the note holds unsaved changes in Glyph.",
    input_schema: || {
        json!({
            "type": "object",
            "properties": {
                "ref": ref_property(),
                "task": {
                    "type": "string",
                    "description": "The task's text, such as `Buy milk`. The whole item, `- [ ] Buy milk`, works too."
                },
                "state": { "type": "string", "enum": ["done", "todo"] },
                "line": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "The 1-based line of the task, to pick among tasks with the same text."
                },
                "vault": vault_property()
            },
            "required": ["ref", "task", "state"],
            "additionalProperties": false
        })
    },
    effect: Effect::Edits,
    handler: update_task,
};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskArgs {
    #[serde(rename = "ref")]
    note: String,
    task: String,
    state: State,
    line: Option<u32>,
    vault: Option<String>,
}

#[derive(Clone, Copy, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
enum State {
    Done,
    Todo,
}

fn update_task(session: &Session, args: Value) -> Result<Value, String> {
    let args: TaskArgs = arguments(args)?;
    edit_note(session, args.vault.as_deref(), &args.note, |text, found| {
        let (_, body_start) = split_frontmatter(text);
        let tasks = parse_tasks(text, body_start);
        let wanted = task_text(&args.task);
        let named: Vec<&Task> = tasks.iter().filter(|task| task.text == wanted).collect();
        let picked: Vec<&Task> = named
            .iter()
            .filter(|task| args.line.is_none_or(|line| task.line == line))
            .copied()
            .collect();
        let task = match (picked.as_slice(), named.len()) {
            ([task], _) => *task,
            ([], 0) => return Err(no_such_task(&tasks, wanted, &found.path)),
            _ => {
                let lines: Vec<u32> = named.iter().map(|task| task.line).collect();
                return Err(format!(
                    "the tasks reading {wanted:?} in {} are on lines {lines:?}; pass `line` as one of them",
                    found.path
                ));
            }
        };
        let done = args.state == State::Done;
        let state = if done { "done" } else { "to do" };
        if task.done == done {
            let summary = format!(
                "The task on line {} is already {state}; nothing changed",
                task.line
            );
            return Ok(Outcome {
                text: None,
                summary,
            });
        }
        let mut edited = text.to_string();
        edited.replace_range(task.mark..=task.mark, if done { "x" } else { " " });
        Ok(Outcome {
            text: Some(edited),
            summary: format!(
                "Marked the task on line {} {state}: {:?}",
                task.line,
                short(&task.text)
            ),
        })
    })
}

/// No task reads `wanted`, so say which ones exist for the model to pick from.
fn no_such_task(tasks: &[Task], wanted: &str, path: &str) -> String {
    const LISTED: usize = 50;
    let known: Vec<String> = tasks
        .iter()
        .take(LISTED)
        .map(|task| format!("{}: {}", task.line, short(&task.text)))
        .collect();
    // A list cut short says so, or it would pass for every task there is.
    let which = if tasks.len() > LISTED {
        format!("the first {LISTED} of its {} tasks", tasks.len())
    } else {
        "its tasks".to_string()
    };
    format!("no task in {path} reads {wanted:?}; {which}, by line, are: {known:?}")
}

#[cfg(test)]
mod tests {
    use super::super::tests::Harness;
    use super::*;

    const NOTE: &str = "Scratch.md";

    /// A note holding `content`, in a vault with every write tool on.
    fn vault(name: &str, content: &str) -> Harness {
        let h = Harness::writing(name);
        h.write(NOTE, content);
        h
    }

    // ------------------------------------------------------------ patch_note

    /// A BOM, a frontmatter block, CRLF endings, a subsection, and a heading
    /// in fenced code that ends nothing.
    const SECTIONS: &str = "\u{feff}---\r\ntitle: T\r\n---\r\n# One\r\n\r\nfirst\r\n\r\n## Sub\r\n\r\n```\r\n# One\r\n```\r\n\r\n# Two\r\n\r\nsecond\r\n";

    fn patch(h: &Harness, section: &str, content: &str, mode: &str) -> Value {
        h.ok(
            "patch_note",
            json!({ "ref": NOTE, "section": section, "content": content, "mode": mode }),
        )
    }

    #[test]
    fn patch_note_leaves_every_byte_outside_the_section_unchanged() {
        let body = "first\r\n\r\n## Sub\r\n\r\n```\r\n# One\r\n```\r\n";
        let at = SECTIONS.find(body).unwrap();
        let (before, after) = (&SECTIONS[..at], &SECTIONS[at + body.len()..]);
        for (mode, expected) in [
            ("replace", "new\r\nlines\r\n".to_string()),
            ("append", format!("{body}new\r\nlines\r\n")),
            ("prepend", format!("new\r\nlines\r\n{body}")),
        ] {
            let h = vault("patch_bytes", SECTIONS);
            // Given with bare newlines, it takes the note's own line ending.
            let result = patch(&h, "One", "new\nlines", mode);
            assert_eq!(result["changed"], true, "{mode}");
            assert_eq!(result["path"], h.path(NOTE));
            let summary = result["summary"].as_str().unwrap();
            assert!(summary.contains("\"One\" (line 4)"), "{summary}");
            assert_eq!(h.read(NOTE), format!("{before}{expected}{after}"), "{mode}");
        }
    }

    #[test]
    fn patch_note_reaches_a_section_with_no_body_and_one_ending_the_note() {
        let h = vault("patch_edges", "# A\n# B\n\n\n# C");
        patch(&h, "A", "in a", "append");
        patch(&h, "B", "in b", "prepend");
        // The last line has no terminator for the new text to follow.
        patch(&h, "C", "in c\n\nmore", "replace");
        assert_eq!(
            h.read(NOTE),
            "# A\nin a\n# B\nin b\n\n\n# C\nin c\n\nmore\n"
        );

        // Emptied; and text that is already there writes nothing.
        assert_eq!(patch(&h, "c", "", "replace")["changed"], true);
        assert_eq!(patch(&h, "c", "", "replace")["changed"], false);
        assert_eq!(patch(&h, "c", "", "append")["changed"], false);
        assert_eq!(patch(&h, "a", "in a", "replace")["changed"], false);
        assert_eq!(h.read(NOTE), "# A\nin a\n# B\nin b\n\n\n# C\n");
    }

    #[test]
    fn patch_note_needs_a_name_that_picks_one_section() {
        let content = "# Mon\n## Tasks\none\n# Tue\n## Tasks\ntwo\n";
        let h = vault("patch_names", content);
        let args = |section: &str| json!({ "ref": NOTE, "section": section, "content": "x", "mode": "append" });

        let twice = h.refused("patch_note", args("Tasks"));
        assert!(
            twice.contains("2 headings") && twice.contains("[2, 5]"),
            "{twice}"
        );
        let none = h.refused("patch_note", args("Wed"));
        assert!(
            none.contains("its headings are") && none.contains("\"Tue\""),
            "{none}"
        );
        let unnamed = json!({ "ref": NOTE, "content": "x", "mode": "append" });
        let unnamed = h.refused("patch_note", unnamed);
        assert!(unnamed.contains("name the section"), "{unnamed}");
        for malformed in [
            json!({ "ref": NOTE, "section": "Mon", "content": "x", "mode": "overwrite" }),
            json!({ "ref": NOTE, "section": "Mon", "mode": "append" }),
            json!({ "ref": NOTE, "section": "Mon", "content": "x", "mode": "append", "force": true }),
        ] {
            let refusal = h.refused("patch_note", malformed);
            assert!(refusal.starts_with("invalid arguments"), "{refusal}");
        }
        assert_eq!(h.read(NOTE), content);

        // The heading can ride on the reference, as it does for read_note.
        let by_ref = json!({ "ref": "Scratch#tue", "content": "x", "mode": "prepend" });
        assert_eq!(h.ok("patch_note", by_ref)["changed"], true);
        assert_eq!(
            h.read(NOTE),
            "# Mon\n## Tasks\none\n# Tue\nx\n## Tasks\ntwo\n"
        );
    }

    #[test]
    fn patch_note_refuses_a_section_whose_bounds_the_rendered_note_does_not_share() {
        // Each holds a heading the slicer and CommonMark read differently, so
        // a replace would take out, or stop short of, what the note shows.
        for content in [
            "# Intro\ntext\n\nNext Chapter\n============\nchapter body\n\n# Last\nlast\n",
            "# Intro\ntext\n # Second\nbody\n# Last\n",
            "# Intro\nintro\n\n````md\n```sh\n# install deps\nnpm i\n```\n````\n\ntail\n# Last\n",
            "# Intro\n````\n``` not a close\n````\n# Next\nbody\n# Last\n",
        ] {
            let h = vault("patch_doubt", content);
            for mode in ["replace", "append", "prepend"] {
                let args =
                    json!({ "ref": NOTE, "section": "Intro", "content": "NEW", "mode": mode });
                let refusal = h.refused("patch_note", args);
                assert!(refusal.contains("is not certain"), "{mode}: {refusal}");
            }
            assert_eq!(h.read(NOTE), content);
        }
    }

    #[test]
    fn a_refusal_listing_headings_says_when_the_list_is_cut() {
        let many: String = (1..=60).map(|n| format!("## Part {n}\n")).collect();
        let h = vault("heading_listing", &many);
        let args = json!({ "ref": NOTE, "section": "Absent", "content": "x", "mode": "append" });
        let refusal = h.refused("patch_note", args);
        assert!(
            refusal.contains("the first 50 of its 60 headings"),
            "{refusal}"
        );
        assert!(!refusal.contains("Part 51"), "{refusal}");
    }

    #[test]
    fn a_summary_quotes_long_text_short() {
        // A result past the size cap would be reported as a failure after
        // the note was written, and retried.
        let long = "x".repeat(5_000);
        let h = vault("summary_short", &format!("# {long}\nbody\n- [ ] {long}\n"));
        let results = [
            patch(&h, &long, "more", "append"),
            // A key YAML still takes as one, well past what a summary quotes.
            set(&h, &long[..300], json!("value")),
            task(&h, &long, "done"),
        ];
        for result in results {
            assert_eq!(result["changed"], true);
            let summary = result["summary"].as_str().unwrap();
            assert!(summary.len() < 300, "{}", summary.len());
        }
    }

    // ---------------------------------------------------------- set_property

    /// Key order, comments beside and between entries, both quote styles and
    /// a block list.
    const PROPERTIES: &str = "\u{feff}---\r\n# Reviewed each quarter\r\ntitle: \"The Plan\"  # shown in the tab\r\nstatus: draft\r\nauthor: 'Ada'\r\ntags:\r\n  - work\r\n  - ideas\r\n\r\n# Dates below\r\ndue: 2026-10-15\r\n---\r\n\r\nstatus: draft\r\n";

    fn set(h: &Harness, key: &str, value: Value) -> Value {
        h.ok(
            "set_property",
            json!({ "ref": NOTE, "key": key, "value": value }),
        )
    }

    #[test]
    fn set_property_keeps_key_order_comments_and_quoting() {
        let h = vault("property_round_trip", PROPERTIES);
        let mut expected = PROPERTIES.to_string();
        let mut step = |result: Value, from: &str, to: &str, summary: &str| {
            expected = expected.replacen(from, to, 1);
            assert_eq!(result["summary"], summary);
            assert_eq!(h.read(NOTE), expected, "{summary}");
        };
        step(
            set(&h, "status", json!("final")),
            "status: draft",
            "status: final",
            "Changed the property \"status\"",
        );
        step(
            set(&h, "title", json!("Plan B")),
            "\"The Plan\"",
            "\"Plan B\"",
            "Changed the property \"title\"",
        );
        step(
            set(&h, "tags", json!(["work", "2026"])),
            "  - work\r\n  - ideas\r\n",
            "  - work\r\n  - \"2026\"\r\n",
            "Changed the property \"tags\"",
        );
        step(
            set(&h, "reviewed", json!(true)),
            "due: 2026-10-15\r\n",
            "due: 2026-10-15\r\nreviewed: true\r\n",
            "Added the property \"reviewed\"",
        );
        step(
            set(&h, "author", Value::Null),
            "author: 'Ada'\r\n",
            "",
            "Removed the property \"author\"",
        );
        step(
            set(&h, "due", json!(7)),
            "due: 2026-10-15",
            "due: 7",
            "Changed the property \"due\"",
        );
    }

    #[test]
    fn set_property_tells_an_empty_value_from_a_removal() {
        let h = vault("property_empty", "---\na: 1\n---\nbody\n");
        assert_eq!(set(&h, "a", json!(""))["changed"], true);
        assert_eq!(h.read(NOTE), "---\na: \"\"\n---\nbody\n");
        assert_eq!(set(&h, "a", json!(""))["changed"], false);
        assert_eq!(set(&h, "a", Value::Null)["changed"], true);
        assert_eq!(h.read(NOTE), "---\n---\nbody\n");
        let gone = set(&h, "a", Value::Null);
        assert_eq!(gone["changed"], false);
        let summary = gone["summary"].as_str().unwrap();
        assert!(summary.contains("has no property"), "{summary}");

        // A note that never had a block gets one.
        h.write(NOTE, "body\n");
        set(&h, "a", json!("b"));
        assert_eq!(h.read(NOTE), "---\na: b\n---\nbody\n");
    }

    #[test]
    fn set_property_refuses_what_it_cannot_write_safely() {
        let malformed = "---\na: [unclosed\n---\nbody\n";
        let h = vault("property_refused", malformed);
        let args = |key: &str, value: Value| json!({ "ref": NOTE, "key": key, "value": value });

        let refusal = h.refused("set_property", args("a", json!("x")));
        assert!(refusal.contains("not YAML Glyph reads"), "{refusal}");
        assert_eq!(h.read(NOTE), malformed);

        h.write(NOTE, "---\na: 1\n---\n");
        for value in [json!({ "nested": 1 }), json!([["deep"]]), json!([null])] {
            let refusal = h.refused("set_property", args("a", value));
            assert!(refusal.starts_with("value must be"), "{refusal}");
        }
        let unnamed = h.refused("set_property", args("  ", json!("x")));
        assert_eq!(unnamed, "key is empty");
        // Leaving `value` out is not a way to remove a property.
        let forgotten = h.refused("set_property", json!({ "ref": NOTE, "key": "a" }));
        assert!(forgotten.contains("missing field `value`"), "{forgotten}");
        assert_eq!(h.read(NOTE), "---\na: 1\n---\n");
    }

    // ----------------------------------------------------------- update_task

    const TASKS: &str = "# List\r\n- [ ] real\r\n```md\r\n- [ ] fenced\r\n```\r\n> - [ ] quoted\r\n\r\n  * [X] nested\r\n- [ ] twin\r\n- [ ] twin\r\n";

    fn task(h: &Harness, task: &str, state: &str) -> Value {
        h.ok(
            "update_task",
            json!({ "ref": NOTE, "task": task, "state": state }),
        )
    }

    #[test]
    fn update_task_ignores_what_only_looks_like_a_task() {
        let h = vault("task_lookalikes", TASKS);
        for lookalike in ["fenced", "quoted", "- [ ] fenced", "> - [ ] quoted"] {
            let args = json!({ "ref": NOTE, "task": lookalike, "state": "done" });
            let refusal = h.refused("update_task", args);
            // The refusal lists the real tasks, and only those.
            assert!(refusal.contains("no task"), "{refusal}");
            assert!(refusal.contains("2: real"), "{refusal}");
            assert!(!refusal.contains("4: fenced"), "{refusal}");
            assert!(!refusal.contains("6: quoted"), "{refusal}");
        }
        assert_eq!(h.read(NOTE), TASKS);
    }

    #[test]
    fn a_refusal_listing_tasks_says_when_the_list_is_cut() {
        let many: String = (1..=60).map(|n| format!("- [ ] task {n}\n")).collect();
        let h = vault("task_listing", &many);
        let args = json!({ "ref": NOTE, "task": "absent", "state": "done" });
        let refusal = h.refused("update_task", args.clone());
        assert!(
            refusal.contains("the first 50 of its 60 tasks"),
            "{refusal}"
        );
        assert!(!refusal.contains("task 51"), "{refusal}");

        h.write(NOTE, "- [ ] only\n");
        let refusal = h.refused("update_task", args);
        assert!(
            refusal.contains("; its tasks, by line, are: [\"1: only\"]"),
            "{refusal}"
        );
    }

    #[test]
    fn update_task_changes_one_mark_and_nothing_else() {
        let h = vault("task_marks", TASKS);
        let done = task(&h, "real", "done");
        assert_eq!(done["summary"], "Marked the task on line 2 done: \"real\"");
        assert_eq!(h.read(NOTE), TASKS.replacen("- [ ] real", "- [x] real", 1));
        // Asked again, it is already so: a retry changes nothing.
        assert_eq!(task(&h, "real", "done")["changed"], false);
        assert_eq!(task(&h, "- [x] real", "todo")["changed"], true);
        assert_eq!(task(&h, "nested", "todo")["changed"], true);
        assert_eq!(h.read(NOTE), TASKS.replacen("[X] nested", "[ ] nested", 1));
    }

    #[test]
    fn update_task_asks_for_a_line_when_the_text_names_several() {
        let h = vault("task_twins", TASKS);
        let args = |line: Option<u32>| json!({ "ref": NOTE, "task": "twin", "state": "done", "line": line });
        for unpicked in [None, Some(2), Some(99)] {
            let refusal = h.refused("update_task", args(unpicked));
            assert!(refusal.contains("lines [9, 10]"), "{refusal}");
        }
        assert_eq!(h.ok("update_task", args(Some(10)))["changed"], true);
        assert!(h.read(NOTE).ends_with("- [ ] twin\r\n- [x] twin\r\n"));
        let undecided = json!({ "ref": NOTE, "task": "twin", "state": "maybe" });
        let refusal = h.refused("update_task", undecided);
        assert!(refusal.starts_with("invalid arguments"), "{refusal}");
    }
}
