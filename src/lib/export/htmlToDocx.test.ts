import { Paragraph, Table } from "docx";
import { describe, expect, it } from "vitest";
import { convertHtmlToDocx } from "./htmlToDocx";

describe("convertHtmlToDocx", () => {
  it("maps headings and paragraphs to paragraph blocks", () => {
    const blocks = convertHtmlToDocx("<h1>Title</h1><p>Body</p>");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b instanceof Paragraph)).toBe(true);
  });

  it("expands list items into one paragraph each, including nested items", () => {
    const blocks = convertHtmlToDocx("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>");
    expect(blocks).toHaveLength(3);
  });

  it("produces a Table for table markup", () => {
    const blocks = convertHtmlToDocx(
      "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>",
    );
    expect(blocks.some((b) => b instanceof Table)).toBe(true);
  });

  it("boxes a note embed in a single-cell table", () => {
    // The embed is a bordered block on screen; DOCX renders it as a table so it
    // stays distinct instead of flattening into the surrounding paragraphs.
    const blocks = convertHtmlToDocx(
      '<div class="markdown-embed"><div class="markdown-embed__body"><h2>Section</h2><p>embedded body</p></div></div>',
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeInstanceOf(Table);
  });

  it("skips empty paragraphs", () => {
    expect(convertHtmlToDocx("<p></p>")).toHaveLength(1); // falls back to a single empty block
  });

  it("recurses into container elements", () => {
    const blocks = convertHtmlToDocx("<div><h2>One</h2><p>Two</p></div>");
    expect(blocks).toHaveLength(2);
  });

  it("always returns at least one block for empty input", () => {
    const blocks = convertHtmlToDocx("");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeInstanceOf(Paragraph);
  });

  it("renders an ordered list with one paragraph per item", () => {
    const blocks = convertHtmlToDocx("<ol><li>one</li><li>two</li></ol>");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b instanceof Paragraph)).toBe(true);
  });

  it("renders blockquote paragraphs", () => {
    const blocks = convertHtmlToDocx("<blockquote><p>a</p><p>b</p></blockquote>");
    expect(blocks).toHaveLength(2);
    expect(blocks.every((b) => b instanceof Paragraph)).toBe(true);
  });

  it("renders a blockquote without inner paragraphs as one paragraph", () => {
    const blocks = convertHtmlToDocx("<blockquote>just text</blockquote>");
    expect(blocks).toHaveLength(1);
  });

  it("renders code blocks and horizontal rules as paragraphs", () => {
    const code = convertHtmlToDocx("<pre>line1\nline2\n</pre>");
    expect(code).toHaveLength(1);
    expect(code[0]).toBeInstanceOf(Paragraph);

    const hr = convertHtmlToDocx("<hr>");
    expect(hr[0]).toBeInstanceOf(Paragraph);
  });

  it("drops standalone SVG diagrams", () => {
    expect(convertHtmlToDocx("<svg><path/></svg>")).toHaveLength(0 + 1); // empty → one fallback block
  });

  it("preserves inline formatting and links inside paragraphs", () => {
    const blocks = convertHtmlToDocx('<p><strong>x</strong> <a href="https://e.com">y</a></p>');
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeInstanceOf(Paragraph);
  });

  it("renders a top-level text node as a paragraph", () => {
    const blocks = convertHtmlToDocx("loose text");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeInstanceOf(Paragraph);
  });

  it("drops whitespace-only and empty inline elements", () => {
    // Whitespace text node and an empty unknown element both contribute nothing,
    // so the document falls back to a single empty paragraph.
    expect(convertHtmlToDocx("   ")).toHaveLength(1);
    expect(convertHtmlToDocx("<span></span>")).toHaveLength(1);
  });

  it("ignores empty table rows", () => {
    const blocks = convertHtmlToDocx("<table><tr></tr><tr><td>1</td></tr></table>");
    expect(blocks.some((b) => b instanceof Table)).toBe(true);
  });

  it("nests an ordered sublist inside a list item", () => {
    const blocks = convertHtmlToDocx("<ul><li>a<ol><li>b</li></ol></li></ul>");
    expect(blocks.length).toBeGreaterThanOrEqual(2);
  });

  it("skips comment nodes at the block level", () => {
    expect(convertHtmlToDocx("<!-- c -->text")).toHaveLength(1);
  });

  it("renders an unknown block-ish element via its inline content", () => {
    expect(convertHtmlToDocx("<kbd>x</kbd>")).toHaveLength(1);
  });

  it("keeps non-list element children of a list item", () => {
    // Exercises the clone-removal loop's branch where a child is not ul/ol.
    const blocks = convertHtmlToDocx("<ul><li><strong>bold</strong> text</li></ul>");
    expect(blocks).toHaveLength(1);
  });

  it("handles text, comment, and whitespace nodes inside a container", () => {
    // The container recurses into a real text node, a comment, and a
    // whitespace-only text node — covering both block text-node branches.
    const blocks = convertHtmlToDocx("<div>hello<!-- c --> </div>");
    expect(blocks).toHaveLength(1);
  });

  it("renders block KaTeX as a single paragraph (LaTeX source, no glyph spans)", () => {
    const katexBlock =
      `<span class="katex-display"><span class="katex"><span class="katex-mathml"><math>` +
      `<semantics><mrow><mi>z</mi></mrow><annotation encoding="application/x-tex">a^2+b^2` +
      `</annotation></semantics></math></span>` +
      `<span class="katex-html" aria-hidden="true">GLYPH_JUNK</span></span></span>`;
    const blocks = convertHtmlToDocx(katexBlock);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toBeInstanceOf(Paragraph);
  });
});
