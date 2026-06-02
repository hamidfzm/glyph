import { describe, expect, it } from "vitest";
import { convertHtmlToPdf } from "./htmlToPdf";

describe("convertHtmlToPdf", () => {
  it("maps headings and paragraphs to content nodes", () => {
    const content = convertHtmlToPdf("<h1>Title</h1><p>Body</p>");
    expect(content).toHaveLength(2);
  });

  it("emits a list node with one item per <li>, nesting sub-lists", () => {
    const content = convertHtmlToPdf("<ul><li>a</li><li>b<ul><li>c</li></ul></li></ul>");
    const list = content[0] as { ul: unknown[] };
    expect(list.ul).toHaveLength(2);
  });

  it("emits a table node for table markup", () => {
    const content = convertHtmlToPdf("<table><tr><th>H</th></tr><tr><td>1</td></tr></table>");
    expect(content.some((c) => typeof c === "object" && c !== null && "table" in c)).toBe(true);
  });

  it("reduces KaTeX to its LaTeX source and drops SVG diagrams", () => {
    const content = convertHtmlToPdf(
      '<p><span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span></p>' +
        "<svg><path/></svg>",
    );
    // The paragraph keeps the LaTeX; the bare <svg> contributes no block.
    expect(JSON.stringify(content)).toContain("x^2");
  });

  it("always returns at least one node for empty input", () => {
    expect(convertHtmlToPdf("")).toHaveLength(1);
  });

  it("renders blockquotes, code blocks, and horizontal rules", () => {
    const content = convertHtmlToPdf("<blockquote><p>q</p></blockquote><pre>code\nline</pre><hr>");
    const json = JSON.stringify(content);
    expect(json).toContain("q");
    expect(json).toContain("code");
    expect(json).toContain("canvas");
  });

  it("embeds decodable images and skips unsupported ones", () => {
    const png = new Array(24).fill(0);
    png[0] = 0x89;
    png[1] = 0x50;
    png[19] = 4;
    png[23] = 2;
    let bin = "";
    for (const b of png) bin += String.fromCharCode(b);
    const uri = `data:image/png;base64,${btoa(bin)}`;

    const withImage = convertHtmlToPdf(`<p><img src="${uri}"></p>`);
    expect(JSON.stringify(withImage)).toContain("image");

    const withSvgImage = convertHtmlToPdf('<p><img src="data:image/svg+xml;base64,AAAA"></p>');
    // Unsupported image yields an empty paragraph (no image node).
    expect(JSON.stringify(withSvgImage)).not.toContain('"image"');
  });

  it("renders ordered lists and links", () => {
    const content = convertHtmlToPdf('<ol><li>one</li></ol><p><a href="https://e.com">x</a></p>');
    const json = JSON.stringify(content);
    expect(json).toContain('"ol"');
    expect(json).toContain("https://e.com");
  });

  it("renders top-level text nodes and recurses into containers", () => {
    expect(convertHtmlToPdf("loose text")).toHaveLength(1);
    const nested = convertHtmlToPdf("<div><h2>One</h2><p>Two</p></div>");
    expect(nested).toHaveLength(2);
  });

  it("embeds a standalone block-level image", () => {
    const png = new Array(24).fill(0);
    png[0] = 0x89;
    png[1] = 0x50;
    png[19] = 4;
    png[23] = 2;
    let bin = "";
    for (const b of png) bin += String.fromCharCode(b);
    const content = convertHtmlToPdf(`<img src="data:image/png;base64,${btoa(bin)}">`);
    expect(JSON.stringify(content)).toContain('"image"');
  });
});
