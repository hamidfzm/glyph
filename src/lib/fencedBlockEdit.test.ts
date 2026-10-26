import { describe, expect, it } from "vitest";
import { replaceFencedBlockBody, replaceSourceDocument } from "./fencedBlockEdit";

describe("replaceFencedBlockBody", () => {
  it("replaces the body of a backtick fence and keeps the text around it", () => {
    const source = "# Title\n\n```excalidraw\nold\n```\n\nAfter\n";
    const next = replaceFencedBlockBody(
      source,
      { startLine: 3, endLine: 5, code: "old" },
      "new\nlines",
    );
    expect(next).toBe("# Title\n\n```excalidraw\nnew\nlines\n```\n\nAfter\n");
  });

  it("keeps a tilde fence and its info string", () => {
    const source = "~~~~excalidraw {title}\nold\n~~~~\n";
    const next = replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "new");
    expect(next).toBe("~~~~excalidraw {title}\nnew\n~~~~\n");
  });

  it("writes the body back behind a list item's indentation", () => {
    const source = "- item\n\n  ```excalidraw\n  old\n\n  more\n  ```\n";
    const next = replaceFencedBlockBody(
      source,
      { startLine: 3, endLine: 7, code: "old\n\nmore" },
      "a\n\nb",
    );
    expect(next).toBe("- item\n\n  ```excalidraw\n  a\n\n  b\n  ```\n");
  });

  it("reads body lines indented less than the fence", () => {
    const source = "  ```excalidraw\nold\n  ```";
    const next = replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "new");
    expect(next).toBe("  ```excalidraw\n  new\n  ```");
  });

  it("writes the body back inside a blockquote", () => {
    const source = "> ```excalidraw\n> old\n>\n> ```\n";
    const next = replaceFencedBlockBody(
      source,
      { startLine: 1, endLine: 4, code: "old" },
      "a\n\nb",
    );
    expect(next).toBe("> ```excalidraw\n> a\n>\n> b\n> ```\n");
  });

  it("refuses a blockquote body line that lost its marker", () => {
    const source = "> ```excalidraw\nold\n> ```\n";
    expect(
      replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "new"),
    ).toBeNull();
  });

  it("replaces an unclosed fence that runs to the end of the document", () => {
    const source = "Intro\n```excalidraw\nold";
    const next = replaceFencedBlockBody(source, { startLine: 2, endLine: 3, code: "old" }, "new");
    expect(next).toBe("Intro\n```excalidraw\nnew");
  });

  it("fills an unclosed fence with no body", () => {
    const next = replaceFencedBlockBody(
      "```excalidraw",
      { startLine: 1, endLine: 1, code: "" },
      "{}",
    );
    expect(next).toBe("```excalidraw\n{}");
  });

  it("fills an empty block", () => {
    const next = replaceFencedBlockBody(
      "```excalidraw\n```\n",
      { startLine: 1, endLine: 2, code: "" },
      "{}",
    );
    expect(next).toBe("```excalidraw\n{}\n```\n");
  });

  it("empties a block", () => {
    const next = replaceFencedBlockBody(
      "```excalidraw\nold\n```",
      { startLine: 1, endLine: 3, code: "old" },
      "",
    );
    expect(next).toBe("```excalidraw\n```");
  });

  it("keeps CRLF line endings and a BOM", () => {
    const source = "﻿Text\r\n```excalidraw\r\nold\r\n```\r\n";
    const next = replaceFencedBlockBody(source, { startLine: 2, endLine: 4, code: "old" }, "a\nb");
    expect(next).toBe("﻿Text\r\n```excalidraw\r\na\r\nb\r\n```\r\n");
  });

  it("matches a multi-line body the pipeline handed over with CRLF line endings", () => {
    const source = '```excalidraw\r\n{\r\n  "a": 1\r\n}\r\n```\r\n';
    const next = replaceFencedBlockBody(
      source,
      { startLine: 1, endLine: 5, code: '{\r\n  "a": 1\r\n}' },
      '{\n  "a": 2\n}',
    );
    expect(next).toBe('```excalidraw\r\n{\r\n  "a": 2\r\n}\r\n```\r\n');
  });

  it("leaves the line endings of the rest of a mixed file alone", () => {
    const source = "one\r\ntwo\n```excalidraw\nold\n```\rlast";
    const next = replaceFencedBlockBody(source, { startLine: 3, endLine: 5, code: "old" }, "a\nb");
    expect(next).toBe("one\r\ntwo\n```excalidraw\na\nb\n```\rlast");
  });

  it("writes no blank line for a trailing newline in the new code", () => {
    const next = replaceFencedBlockBody(
      "```x\nold\n```",
      { startLine: 1, endLine: 3, code: "old" },
      "new\n",
    );
    expect(next).toBe("```x\nnew\n```");
  });

  it("saves a fence that opens a list item, under the item's content", () => {
    const source = "- ```excalidraw\n  old\n  ```\n1. ```x\n   one\n   ```";
    expect(replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "new")).toBe(
      "- ```excalidraw\n  new\n  ```\n1. ```x\n   one\n   ```",
    );
    expect(replaceFencedBlockBody(source, { startLine: 4, endLine: 6, code: "one" }, "two")).toBe(
      "- ```excalidraw\n  old\n  ```\n1. ```x\n   two\n   ```",
    );
  });

  it("lengthens the fence when the new body holds a run that would close it", () => {
    const source = "```excalidraw\nold\n```\n";
    const next = replaceFencedBlockBody(
      source,
      { startLine: 1, endLine: 3, code: "old" },
      "x\n````\ny",
    );
    expect(next).toBe("`````excalidraw\nx\n````\ny\n`````\n");
  });

  it("ignores a run of the other fence character", () => {
    const source = "```excalidraw\nold\n```";
    const next = replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "~~~~");
    expect(next).toBe("```excalidraw\n~~~~\n```");
  });

  it("rewrites only the drawing of an Obsidian Excalidraw note", () => {
    const head = [
      "---",
      "excalidraw-plugin: parsed",
      "tags: [excalidraw]",
      "---",
      "==Switch to EXCALIDRAW VIEW==",
      "",
      "# Excalidraw Data",
      "## Text Elements",
      "Hello ^abc123",
      "",
      "%%",
      "## Drawing",
    ].join("\r\n");
    const source = `${head}\r\n\`\`\`compressed-json\r\nAAAA\r\n\r\nBBBB\r\n\`\`\`\r\n%%`;
    const next = replaceFencedBlockBody(
      source,
      { startLine: 13, endLine: 17, code: "AAAA\n\nBBBB" },
      "CCCC\n\nDDDD",
    );
    expect(next).toBe(`${head}\r\n\`\`\`compressed-json\r\nCCCC\r\n\r\nDDDD\r\n\`\`\`\r\n%%`);
  });

  it("refuses when the body changed since the render", () => {
    const source = "```excalidraw\nedited\n```";
    expect(
      replaceFencedBlockBody(source, { startLine: 1, endLine: 3, code: "old" }, "new"),
    ).toBeNull();
  });

  it("refuses when the start line is not a fence", () => {
    const source = "text\n```excalidraw\nold\n```";
    expect(
      replaceFencedBlockBody(source, { startLine: 1, endLine: 4, code: "old" }, "new"),
    ).toBeNull();
  });

  it("refuses lines outside the document", () => {
    const source = "```excalidraw\nold\n```";
    expect(
      replaceFencedBlockBody(source, { startLine: 0, endLine: 3, code: "old" }, "x"),
    ).toBeNull();
    expect(
      replaceFencedBlockBody(source, { startLine: 1, endLine: 9, code: "old" }, "x"),
    ).toBeNull();
    expect(
      replaceFencedBlockBody(source, { startLine: 3, endLine: 1, code: "old" }, "x"),
    ).toBeNull();
  });
});

describe("replaceSourceDocument", () => {
  it("replaces the whole text and keeps the final newline", () => {
    expect(replaceSourceDocument('{"a":1}\n', '{"a":1}', '{\n  "a": 2\n}\n')).toBe(
      '{\n  "a": 2\n}\n',
    );
  });

  it("adds no final newline the file did not have", () => {
    expect(replaceSourceDocument("old", "old", "new\n")).toBe("new");
  });

  it("keeps CRLF line endings and a BOM", () => {
    expect(replaceSourceDocument("﻿old\r\n", "old", "a\nb")).toBe("﻿a\r\nb\r\n");
  });

  it("refuses when the file changed since the render", () => {
    expect(replaceSourceDocument("edited\n", "old", "new")).toBeNull();
  });

  it("fills an empty file", () => {
    expect(replaceSourceDocument("", "", "{}")).toBe("{}");
  });
});
