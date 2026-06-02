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
    const content = convertHtmlToPdf(`<img src="${pngDataUri()}">`);
    expect(JSON.stringify(content)).toContain('"image"');
  });

  it("covers inline formatting, breaks, comments, and bare anchors", () => {
    const content = convertHtmlToPdf(
      "<p><strong>b</strong><em>i</em><del>s</del><code>c</code>plain" +
        "<br><a>bare</a><!-- comment --><span>span</span></p>",
    );
    expect(content).toHaveLength(1);
    // The strike run carries a lineThrough decoration.
    expect(JSON.stringify(content)).toContain("lineThrough");
  });

  it("falls back to KaTeX textContent when there's no annotation", () => {
    const content = convertHtmlToPdf('<p><span class="katex">x2</span></p>');
    expect(JSON.stringify(content)).toContain("x2");
  });

  it("uses inline image alt text and skips alt-less inline images", () => {
    const withAlt = convertHtmlToPdf('<p>see <img src="https://x/y.png" alt="chart"></p>');
    expect(JSON.stringify(withAlt)).toContain("chart");
    // Alt-less inline image contributes nothing but the surrounding text stays.
    const noAlt = convertHtmlToPdf('<p>see <img src="https://x/y.png"></p>');
    expect(JSON.stringify(noAlt)).toContain("see");
  });

  it("renders a paragraph that is only an undecodable image as empty", () => {
    const content = convertHtmlToPdf('<p><img src="data:image/gif;base64,AAAA"></p>');
    expect(JSON.stringify(content)).not.toContain('"image"');
  });

  it("builds tables with header and data rows, ignoring empty rows", () => {
    const content = convertHtmlToPdf(
      "<table><thead><tr><th>A</th><th>B</th></tr></thead>" +
        "<tbody><tr></tr><tr><td>1</td><td>2</td></tr></tbody></table>",
    );
    const table = content.find(
      (c) => typeof c === "object" && c !== null && "table" in (c as object),
    ) as { table: { body: unknown[] } } | undefined;
    // Header row + one data row; the empty <tr> is dropped.
    expect(table?.table.body).toHaveLength(2);
  });

  it("renders every heading level", () => {
    const content = convertHtmlToPdf(
      "<h1>1</h1><h2>2</h2><h3>3</h3><h4>4</h4><h5>5</h5><h6>6</h6>",
    );
    expect(content).toHaveLength(6);
  });

  it("drops whitespace-only text nodes and empty paragraphs", () => {
    expect(convertHtmlToPdf("   ")).toHaveLength(1); // fallback empty node
    expect(convertHtmlToPdf("<p></p>")).toHaveLength(1);
  });
});

function pngDataUri(): string {
  const png = new Array(24).fill(0);
  png[0] = 0x89;
  png[1] = 0x50;
  png[19] = 4;
  png[23] = 2;
  let bin = "";
  for (const b of png) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}
