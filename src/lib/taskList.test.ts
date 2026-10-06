import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toggleTaskAtLine } from "./taskList";

describe("toggleTaskAtLine", () => {
  it("toggles unchecked → checked", () => {
    expect(toggleTaskAtLine("- [ ] todo", 1)).toBe("- [x] todo");
  });

  it("toggles checked → unchecked", () => {
    expect(toggleTaskAtLine("- [x] done", 1)).toBe("- [ ] done");
  });

  it("treats uppercase X as checked", () => {
    expect(toggleTaskAtLine("- [X] done", 1)).toBe("- [ ] done");
  });

  it("preserves indentation", () => {
    expect(toggleTaskAtLine("    - [ ] nested", 1)).toBe("    - [x] nested");
  });

  it("works with `*` and `+` bullets", () => {
    expect(toggleTaskAtLine("* [ ] star", 1)).toBe("* [x] star");
    expect(toggleTaskAtLine("+ [ ] plus", 1)).toBe("+ [x] plus");
  });

  it("targets the right line in a multi-line document", () => {
    const src = "intro\n- [ ] first\n- [x] second\nend";
    expect(toggleTaskAtLine(src, 2)).toBe("intro\n- [x] first\n- [x] second\nend");
    expect(toggleTaskAtLine(src, 3)).toBe("intro\n- [ ] first\n- [ ] second\nend");
  });

  it("preserves CRLF line endings", () => {
    const src = "- [ ] a\r\n- [x] b";
    expect(toggleTaskAtLine(src, 1)).toBe("- [x] a\r\n- [x] b");
    expect(toggleTaskAtLine(src, 2)).toBe("- [ ] a\r\n- [ ] b");
  });

  it("keeps a leading BOM", () => {
    const src = "\uFEFF- [ ] a\n- [ ] b";
    expect(toggleTaskAtLine(src, 1)).toBe("\uFEFF- [x] a\n- [ ] b");
    expect(toggleTaskAtLine(src, 2)).toBe("\uFEFF- [ ] a\n- [x] b");
  });

  it("returns input unchanged when the line has no checkbox", () => {
    const src = "regular paragraph";
    expect(toggleTaskAtLine(src, 1)).toBe(src);
  });

  it("returns input unchanged for out-of-range lines", () => {
    expect(toggleTaskAtLine("- [ ] only", 0)).toBe("- [ ] only");
    expect(toggleTaskAtLine("- [ ] only", 5)).toBe("- [ ] only");
  });

  it("ignores `[ ]` not preceded by a list bullet (e.g. inside a paragraph)", () => {
    expect(toggleTaskAtLine("see [ ] in text", 1)).toBe("see [ ] in text");
  });
});

// The MCP server ports this pattern (`src-tauri/src/vault/tasks.rs`). Both are
// held to `vault-tasks.json`, so a change to either fails here and in
// `vault::tasks::tests::task_lines_match_the_shared_expectation` together.
describe("the shared task fixture", () => {
  const expected: { lines: { line: string; task: boolean }[] } = JSON.parse(
    readFileSync(path.join(process.cwd(), "src-tauri", "fixtures", "vault-tasks.json"), "utf-8"),
  );

  it.each(expected.lines)("agrees with the Rust matcher on $line", ({ line, task }) => {
    expect(toggleTaskAtLine(line, 1) !== line).toBe(task);
  });
});
