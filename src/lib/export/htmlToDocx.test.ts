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
});
