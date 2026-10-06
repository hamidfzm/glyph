//! Task list items, matched the way a click on a rendered checkbox matches
//! them in `src/lib/taskList.ts`. `fixtures/vault-tasks.json` holds both sides
//! to the same lines. The renderer only offers a checkbox for a list item its
//! parser found, so the lines it never reaches are skipped here: fenced code,
//! and a quoted task, whose line opens with `>` and so never matches.

use super::headings::{is_js_space, js_line_starts, Fences};

#[derive(Debug, PartialEq)]
pub(crate) struct Task {
    /// 1-based, like a heading's line.
    pub line: u32,
    pub done: bool,
    pub text: String,
    /// The byte of the note holding the mark between the brackets.
    pub mark: usize,
}

/// `^(\s*[-*+]\s+)\[([ xX])\](\s)`: where the mark sits in `line`.
// ponytail: an indented code block holding a task-looking line matches, as it
// does for the click handler's own pattern; telling one from a nested list
// item needs the list structure, which a block parser would bring.
fn mark_in(line: &str) -> Option<usize> {
    let bullet = line.trim_start_matches(is_js_space);
    let spaced = bullet.strip_prefix(['-', '*', '+'])?;
    let boxed = spaced.trim_start_matches(is_js_space);
    if boxed.len() == spaced.len() {
        return None;
    }
    let mut after = boxed.strip_prefix('[')?.chars();
    let marked = matches!(after.next(), Some(' ' | 'x' | 'X'));
    let closed = after.next() == Some(']') && after.next().is_some_and(is_js_space);
    (marked && closed).then_some(line.len() - boxed.len() + 1)
}

/// The text of a task written as `line`, or `line` itself when it is not one:
/// what a caller means by a task whether it gives the text or the whole item.
pub(crate) fn task_text(line: &str) -> &str {
    let text = mark_in(line).map_or(line, |mark| &line[mark + 2..]);
    text.trim_matches(is_js_space)
}

/// Every task from line `body_start` on, skipping fenced code.
pub(crate) fn parse_tasks(content: &str, body_start: usize) -> Vec<Task> {
    let mut tasks = Vec::new();
    let mut fences = Fences::new();
    for (idx, (start, line)) in js_line_starts(content).enumerate().skip(body_start) {
        if fences.skip(line) {
            continue;
        }
        if let Some(mark) = mark_in(line) {
            tasks.push(Task {
                line: (idx + 1) as u32,
                done: !line[mark..].starts_with(' '),
                text: task_text(line).to_string(),
                mark: start + mark,
            });
        }
    }
    tasks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::test_support::fixtures_dir;

    #[test]
    fn task_lines_match_the_shared_expectation() {
        // `src/lib/taskList.test.ts` holds the click handler to the same file.
        let raw = std::fs::read_to_string(fixtures_dir().join("vault-tasks.json")).unwrap();
        let expected: serde_json::Value = serde_json::from_str(&raw).unwrap();
        for case in expected["lines"].as_array().unwrap() {
            let line = case["line"].as_str().unwrap();
            assert_eq!(
                mark_in(line).is_some(),
                case["task"].as_bool().unwrap(),
                "{line:?}"
            );
        }
    }

    #[test]
    fn a_task_carries_its_line_state_text_and_mark() {
        let md = "intro\r\n- [ ] first\r\n  * [X] second  \r\n";
        let tasks = parse_tasks(md, 0);
        assert_eq!(
            tasks,
            [
                Task {
                    line: 2,
                    done: false,
                    text: "first".into(),
                    mark: 10
                },
                Task {
                    line: 3,
                    done: true,
                    text: "second".into(),
                    mark: 25
                },
            ]
        );
        assert_eq!(&md[tasks[0].mark..=tasks[0].mark], " ");
        assert_eq!(&md[tasks[1].mark..=tasks[1].mark], "X");
    }

    #[test]
    fn fenced_code_and_quotes_hold_no_tasks() {
        let md = "- [ ] real\n```md\n- [ ] in a fence\n```\n~~~\n- [x] in tildes\n~~~\n> - [ ] quoted\n> > - [x] quoted twice\n- [x] also real\n";
        let lines: Vec<u32> = parse_tasks(md, 0).iter().map(|task| task.line).collect();
        assert_eq!(lines, [1, 10]);
    }

    #[test]
    fn the_frontmatter_block_holds_no_tasks() {
        let md = "---\nlist:\n- [ ] yaml, not a task\n---\n- [ ] body\n";
        let lines: Vec<u32> = parse_tasks(md, 4).iter().map(|task| task.line).collect();
        assert_eq!(lines, [5]);
    }

    #[test]
    fn a_task_is_named_by_its_text_or_by_its_whole_line() {
        assert_eq!(task_text("buy milk"), "buy milk");
        assert_eq!(task_text("  buy milk "), "buy milk");
        assert_eq!(task_text("- [ ] buy milk"), "buy milk");
        assert_eq!(task_text("  * [x]  buy milk  "), "buy milk");
        // Not a task line, so it is taken as text, brackets and all.
        assert_eq!(task_text("[ ] buy milk"), "[ ] buy milk");
    }
}
