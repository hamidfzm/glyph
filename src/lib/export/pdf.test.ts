import { describe, expect, it } from "vitest";
import { buildPdf } from "./pdf";

describe("buildPdf", () => {
  it("produces a PDF byte stream with the %PDF signature", async () => {
    const bytes = await buildPdf("<h1>Title</h1><p>Body with <strong>bold</strong>.</p>", {
      title: "Doc",
      author: "Ada",
    });
    expect(bytes.length).toBeGreaterThan(100);
    // "%PDF"
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });

  it("handles lists, tables, code, quotes, and links without throwing", async () => {
    const html =
      "<ol><li>one</li><li>two<ul><li>nested</li></ul></li></ol>" +
      "<table><tr><th>H</th></tr><tr><td>c</td></tr></table>" +
      "<blockquote><p>quote</p></blockquote>" +
      "<pre>const a = 1;\nconst b = 2;</pre>" +
      "<hr>" +
      '<p><a href="https://example.com">link</a></p>';
    const bytes = await buildPdf(html, { title: "Doc" });
    expect(bytes.length).toBeGreaterThan(100);
  });
});
