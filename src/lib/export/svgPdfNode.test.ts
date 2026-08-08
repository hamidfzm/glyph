import { describe, expect, it } from "vitest";
import { CONTENT_WIDTH, svgNode } from "./svgPdfNode";

function svgEl(markup: string): Element {
  const div = document.createElement("div");
  div.innerHTML = markup;
  const el = div.querySelector("svg");
  if (!el) throw new Error("no svg in markup");
  return el;
}

describe("svgNode", () => {
  it("sizes from the width attribute, capped at the content width", () => {
    const sized = svgNode(svgEl('<svg width="120" height="60"><rect/></svg>')) as {
      svg: string;
      width: number;
    };
    expect(sized.width).toBe(120);
    expect(sized.svg).toContain("<rect");
    // The sanitizer strips xmlns from diagram SVGs; the embed restores it.
    expect(sized.svg).toContain('xmlns="http://www.w3.org/2000/svg"');

    const capped = svgNode(svgEl('<svg width="2000"><rect/></svg>')) as { width: number };
    expect(capped.width).toBe(CONTENT_WIDTH);
  });

  it("sizes from the viewBox when width is missing or relative", () => {
    // Mermaid emits width="100%" plus a viewBox; the viewBox wins.
    const node = svgNode(svgEl('<svg width="100%" viewBox="0 0 240 80"><rect/></svg>')) as {
      width: number;
    };
    expect(node.width).toBe(240);
    // No usable size at all falls back to the full content width.
    const fallback = svgNode(svgEl("<svg><rect/></svg>")) as { width: number };
    expect(fallback.width).toBe(CONTENT_WIDTH);
  });

  it("ignores an unparseable width attribute and falls through to the viewBox", () => {
    const node = svgNode(svgEl('<svg width="auto" viewBox="0 0 64 32"><rect/></svg>')) as {
      width: number;
    };
    expect(node.width).toBe(64);
  });

  it("ignores a degenerate viewBox (zero or non-numeric width)", () => {
    const zero = svgNode(svgEl('<svg viewBox="0 0 0 80"><rect/></svg>')) as { width: number };
    expect(zero.width).toBe(CONTENT_WIDTH);
    const junk = svgNode(svgEl('<svg viewBox="0 0 abc 80"><rect/></svg>')) as { width: number };
    expect(junk.width).toBe(CONTENT_WIDTH);
  });

  it("passes a mounted element through so pdfmake resolves its CSS", () => {
    // A diagram mounted in the live document must reach pdfmake as an element:
    // that is what switches its renderer to getComputedStyle, which is the only
    // way Mermaid's descendant style rules survive into the PDF.
    const host = document.createElement("div");
    host.innerHTML = '<svg width="120"><rect/></svg>';
    document.body.appendChild(host);
    try {
      const node = svgNode(host.querySelector("svg")!) as { svg: unknown; width: number };
      expect(node.svg).toBeInstanceOf(Element);
      expect(node.width).toBe(120);
    } finally {
      host.remove();
    }
    // The same element, once detached, has no computed style and goes as markup.
    const detached = svgNode(svgEl('<svg width="120"><rect/></svg>')) as { svg: unknown };
    expect(typeof detached.svg).toBe("string");
  });

  it("keeps an existing xmlns untouched", () => {
    const node = svgNode(
      svgEl('<svg xmlns="http://www.w3.org/2000/svg" width="10"><g/></svg>'),
    ) as { svg: string };
    expect(node.svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
  });
});
