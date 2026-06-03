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

  it("skips inline SVG and empty math while keeping surrounding text", () => {
    const content = convertHtmlToPdf('<p>a<svg></svg><span class="katex">   </span>b</p>');
    const json = JSON.stringify(content);
    expect(json).toContain("a");
    expect(json).toContain("b");
  });

  it("embeds a JPEG block image", () => {
    const content = convertHtmlToPdf(`<p><img src="${jpgDataUri()}"></p>`);
    expect(JSON.stringify(content)).toContain('"image"');
  });

  it("renders a paragraph whose only image is undecodable as empty", () => {
    const content = convertHtmlToPdf('<p><img src="https://example.com/x.png"></p>');
    expect(JSON.stringify(content)).not.toContain('"image"');
  });

  it("nests an ordered sublist in a PDF list", () => {
    const content = convertHtmlToPdf("<ul><li>a<ol><li>b</li></ol></li></ul>");
    expect(JSON.stringify(content)).toContain('"ol"');
  });

  it("handles a table that has only an empty row", () => {
    const content = convertHtmlToPdf("<table><tr></tr></table>");
    const table = content.find(
      (c) => typeof c === "object" && c !== null && "table" in (c as object),
    );
    expect(table).toBeTruthy();
  });

  it("skips comment nodes and renders a blockquote without inner paragraphs", () => {
    expect(convertHtmlToPdf("<!-- c -->text")).toHaveLength(1);
    const quote = convertHtmlToPdf("<blockquote>quote text</blockquote>");
    expect(JSON.stringify(quote)).toContain("quote text");
  });

  it("drops a standalone undecodable image", () => {
    expect(convertHtmlToPdf('<img src="data:image/svg+xml;base64,AAAA">')).toHaveLength(1);
  });

  it("keeps non-list element children of a list item", () => {
    const content = convertHtmlToPdf("<ul><li><strong>bold</strong> text</li></ul>");
    expect(JSON.stringify(content)).toContain("bold");
  });

  it("renders a paragraph whose only image has no src as empty", () => {
    const content = convertHtmlToPdf("<p><img></p>");
    expect(JSON.stringify(content)).not.toContain('"image"');
  });

  it("handles text, comment, and whitespace nodes inside a container", () => {
    const content = convertHtmlToPdf("<div>hello<!-- c --> </div>");
    expect(JSON.stringify(content)).toContain("hello");
  });

  // Mirrors KaTeX's real output: a MathML branch carrying the LaTeX annotation
  // plus an aria-hidden HTML branch of rendered glyph spans.
  const katex = (tex: string) =>
    `<span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>z</mi></mrow>` +
    `<annotation encoding="application/x-tex">${tex}</annotation></semantics></math></span>` +
    `<span class="katex-html" aria-hidden="true">GLYPH_JUNK</span></span>`;

  it("extracts block KaTeX as LaTeX source instead of its glyph spans", () => {
    // `$$...$$` renders as a block-level katex-display wrapper.
    const content = convertHtmlToPdf(`<span class="katex-display">${katex("a^2+b^2")}</span>`);
    const json = JSON.stringify(content);
    expect(json).toContain("a^2+b^2");
    expect(json).not.toContain("GLYPH_JUNK");
  });

  it("extracts inline KaTeX inside a paragraph", () => {
    const content = convertHtmlToPdf(`<p>see ${katex("x_1")} here</p>`);
    const json = JSON.stringify(content);
    expect(json).toContain("x_1");
    expect(json).toContain("see");
    expect(json).not.toContain("GLYPH_JUNK");
  });

  it("drops an empty inline-level element at block position", () => {
    // <span></span> is inline-level with no content → contributes no block.
    expect(convertHtmlToPdf("<span></span>")).toHaveLength(1); // fallback empty node
  });

  it("renders external links as a colored, clickable text leaf", () => {
    const content = convertHtmlToPdf('<p><a href="https://example.com">site</a></p>');
    const json = JSON.stringify(content);
    expect(json).toContain('"link":"https://example.com"');
    expect(json).toContain('"site"');
    expect(json).toContain("1a56db");
  });

  it("falls back to the URL when an external link has no visible text", () => {
    const content = convertHtmlToPdf('<p><a href="https://example.com"></a></p>');
    expect(JSON.stringify(content)).toContain('"text":"https://example.com"');
  });

  it("renders code blocks as colored runs using inlined token colors", () => {
    const content = convertHtmlToPdf(
      '<pre style="background-color: rgb(40,42,54); color: rgb(248,248,242)">' +
        '<code><span style="color: rgb(255,121,198)">const</span> x = ' +
        '<span style="color: rgb(241,250,140)">1</span>;\n</code></pre>',
    );
    const json = JSON.stringify(content);
    // Keyword + number token colors converted to hex.
    expect(json).toContain("#ff79c6");
    expect(json).toContain("#f1fa8c");
    expect(json).toContain("const");
    // The block background comes from the <pre> (fillColor is a callback).
    const block = content[0] as unknown as { layout: { fillColor: () => string } };
    expect(block.layout.fillColor()).toBe("#282a36");
  });

  it("renders code without inlined colors as plain runs on the default fill", () => {
    const content = convertHtmlToPdf("<pre><code>plain code</code></pre>");
    expect(JSON.stringify(content)).toContain("plain code");
    const block = content[0] as unknown as { layout: { fillColor: () => string } };
    expect(block.layout.fillColor()).toBe("#f4f4f4"); // default fill
  });

  it("passes hex/named code colors through and treats transparent fill as default", () => {
    const hexed = convertHtmlToPdf(
      '<pre style="background-color: rgba(0,0,0,0)"><code>' +
        '<span style="color: #abcdef">tok</span>x\n</code></pre>',
    );
    expect(JSON.stringify(hexed)).toContain("#abcdef");
    const block = hexed[0] as unknown as { layout: { fillColor: () => string } };
    expect(block.layout.fillColor()).toBe("#f4f4f4"); // transparent → default
  });

  it("handles a code block that is empty, has comments, or ends with a blank line", () => {
    expect(convertHtmlToPdf("<pre></pre>")).toHaveLength(1);
    // A trailing newline-only run is dropped; a comment node is ignored.
    const content = convertHtmlToPdf(
      '<pre><code><span style="color:#111">x</span><!-- c -->\n</code></pre>',
    );
    expect(JSON.stringify(content)).toContain("#111");
  });

  it("renders in-page and relative links as plain text (no link node)", () => {
    const content = convertHtmlToPdf('<p><a href="#h">jump</a> <a href="./x.md">rel</a></p>');
    const json = JSON.stringify(content);
    expect(json).toContain("jump");
    expect(json).toContain("rel");
    expect(json).not.toContain('"link"');
  });
});

function jpgDataUri(): string {
  // FFD8 ... SOF0 (FFC0) declaring 9x7, enough for pdfmake to accept it.
  const bytes = [0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x07, 0x00, 0x09, 0xff, 0xd9];
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/jpeg;base64,${btoa(bin)}`;
}

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
