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

  it("keeps an existing xmlns untouched", () => {
    const node = svgNode(
      svgEl('<svg xmlns="http://www.w3.org/2000/svg" width="10"><g/></svg>'),
    ) as { svg: string };
    expect(node.svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
  });
});
