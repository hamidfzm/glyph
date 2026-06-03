import { describe, expect, it } from "vitest";
import { buildDocx } from "./docx";

describe("buildDocx", () => {
  it("produces a non-empty .docx (zip) byte stream", async () => {
    const bytes = await buildDocx("<h1>Title</h1><p>Body with <strong>bold</strong>.</p>", {
      title: "Doc",
      author: "Ada",
    });
    expect(bytes.length).toBeGreaterThan(100);
    // DOCX is a zip; the OOXML container starts with the PK signature.
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it("handles lists, tables, code, and links without throwing", async () => {
    const html =
      "<ol><li>one</li><li>two</li></ol>" +
      "<table><tr><th>H</th></tr><tr><td>c</td></tr></table>" +
      "<pre>const a = 1;\nconst b = 2;</pre>" +
      '<p><a href="https://example.com">link</a></p>';
    const bytes = await buildDocx(html, { title: "Doc" });
    expect(bytes.length).toBeGreaterThan(100);
  });
});
