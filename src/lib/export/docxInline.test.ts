import { ExternalHyperlink, ImageRun, TextRun } from "docx";
import { describe, expect, it } from "vitest";
import { inlineRuns } from "./docxInline";

function el(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

// 24-byte PNG header with a parseable IHDR (4x2), enough for ImageRun to embed.
function pngDataUri(): string {
  const bytes = new Array(24).fill(0);
  bytes[0] = 0x89;
  bytes[1] = 0x50;
  bytes[19] = 4;
  bytes[23] = 2;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

describe("inlineRuns", () => {
  it("emits plain text as a single run", () => {
    const runs = inlineRuns(el("hello world"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBeInstanceOf(TextRun);
  });

  it("carries bold/italic/strike/code formatting through nested tags", () => {
    const runs = inlineRuns(el("<strong>a<em>b</em></strong> <del>c</del> <code>d</code>"));
    // a, b, space, c, d → all TextRuns
    expect(runs.every((r) => r instanceof TextRun)).toBe(true);
    expect(runs.length).toBeGreaterThanOrEqual(4);
  });

  it("wraps anchors with an href in an ExternalHyperlink", () => {
    const runs = inlineRuns(el('<a href="https://example.com">link</a>'));
    expect(runs[0]).toBeInstanceOf(ExternalHyperlink);
  });

  it("flattens anchors without an href to their text runs", () => {
    const runs = inlineRuns(el("<a>bare</a>"));
    expect(runs.every((r) => r instanceof TextRun)).toBe(true);
  });

  it("turns <br> into a break run", () => {
    const runs = inlineRuns(el("a<br>b"));
    expect(runs).toHaveLength(3);
    expect(runs.every((r) => r instanceof TextRun)).toBe(true);
  });

  it("embeds a decodable image and falls back to alt text otherwise", () => {
    const embedded = inlineRuns(el(`<img src="${pngDataUri()}" alt="x">`));
    expect(embedded[0]).toBeInstanceOf(ImageRun);

    const fallback = inlineRuns(el('<img src="data:image/svg+xml;base64,AAAA" alt="diagram">'));
    expect(fallback[0]).toBeInstanceOf(TextRun);
  });

  it("reduces KaTeX to its LaTeX source", () => {
    const runs = inlineRuns(
      el('<span class="katex"><annotation encoding="application/x-tex">x^2</annotation></span>'),
    );
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBeInstanceOf(TextRun);
  });

  it("skips raw SVG", () => {
    expect(inlineRuns(el("<svg><path/></svg>"))).toHaveLength(0);
  });

  it("skips comment and empty text nodes", () => {
    const div = document.createElement("div");
    div.innerHTML = "a<!-- c -->b";
    div.appendChild(document.createTextNode("")); // zero-length text node
    const runs = inlineRuns(div);
    expect(runs).toHaveLength(2); // only "a" and "b"
  });

  it("uses KaTeX textContent without an annotation and skips empty math", () => {
    expect(inlineRuns(el('<span class="katex">x2</span>'))).toHaveLength(1);
    expect(inlineRuns(el('<span class="katex">   </span>'))).toHaveLength(0);
  });

  it("falls back to empty text for an image with no src and no alt", () => {
    const runs = inlineRuns(el("<img>"));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toBeInstanceOf(TextRun);
  });

  it("recurses through unknown inline tags", () => {
    expect(inlineRuns(el("<sup>2</sup>"))).toHaveLength(1);
  });
});
