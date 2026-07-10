import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDocx } from "./docx";

async function documentXml(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);
  return zip.file("word/document.xml")!.async("string");
}

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

  it("marks RTL blocks bidirectional and leaves LTR blocks alone", async () => {
    const rtl = await documentXml(
      await buildDocx("<h1>سرفصل</h1><p>سلام دنیا</p><ul><li>مورد</li></ul>", { title: "Doc" }),
    );
    expect(rtl).toContain("<w:bidi/>");

    const ltr = await documentXml(
      await buildDocx("<h1>Title</h1><p>Hello</p><ul><li>item</li></ul>", { title: "Doc" }),
    );
    expect(ltr).not.toContain("<w:bidi/>");
  });

  it("keeps code blocks LTR even in an RTL document", async () => {
    const xml = await documentXml(
      await buildDocx("<p>سلام</p><pre>let x = 1</pre>", { title: "Doc" }),
    );
    // Exactly one bidi paragraph: the Persian one, not the code block.
    expect(xml.match(/<w:bidi\/>/g)).toHaveLength(1);
  });
});
