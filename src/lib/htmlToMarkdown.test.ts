import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "./htmlToMarkdown";

describe("htmlToMarkdown", () => {
  it("converts headings, emphasis and links", () => {
    expect(htmlToMarkdown("<h2>Title</h2><p><strong>bold</strong> and <em>italic</em></p>")).toBe(
      "## Title\n\n**bold** and *italic*",
    );
    expect(htmlToMarkdown('<a href="https://glyph.md">Glyph</a>')).toBe(
      "[Glyph](https://glyph.md)",
    );
  });

  it("converts lists", () => {
    expect(htmlToMarkdown("<ul><li>one</li><li>two</li></ul>")).toBe("- one\n- two");
    expect(htmlToMarkdown("<ol><li>one</li><li>two</li></ol>")).toBe("1. one\n2. two");
  });

  it("converts inline and block code", () => {
    expect(htmlToMarkdown("<p>run <code>ls</code></p>")).toBe("run `ls`");
    expect(htmlToMarkdown("<pre><code>a\nb</code></pre>")).toBe("```\na\nb\n```");
  });

  it("converts tables and strikethrough through GFM", () => {
    expect(htmlToMarkdown("<table><tr><th>a</th></tr><tr><td>1</td></tr></table>")).toBe(
      "| a |\n| - |\n| 1 |",
    );
    expect(htmlToMarkdown("<del>gone</del>")).toBe("~~gone~~");
  });

  it("keeps unclosed tags from throwing and returns their text", () => {
    expect(htmlToMarkdown("<p>one<p>two<strong>three")).toBe("one\n\ntwo**three**");
  });

  it("returns an empty string for markup with no content", () => {
    expect(htmlToMarkdown("")).toBe("");
    expect(htmlToMarkdown("<div><span></span></div>")).toBe("");
  });
});
