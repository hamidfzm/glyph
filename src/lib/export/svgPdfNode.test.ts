import vfs from "pdfmake/build/vfs_fonts";
import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64 } from "@/lib/base64";
import { buildWoff, type WoffTable } from "@/test/woff";
import { embeddedFontsReady } from "./embeddedFonts";
import { pdfEngine } from "./pdfEngine";
import { CONTENT_HEIGHT, CONTENT_WIDTH, svgNode } from "./svgPdfNode";

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

    const capped = svgNode(svgEl('<svg width="2000" height="1000"><rect/></svg>')) as {
      width: number;
    };
    expect(capped.width).toBe(CONTENT_WIDTH);
  });

  it("takes the size from the viewBox when width is missing or relative", () => {
    // Mermaid emits width="100%" and no height at all. pdfmake parses "100%"
    // as 100, so without this the diagram is laid out with a 100-wide aspect
    // ratio and spills over several near-empty pages.
    const el = svgEl('<svg width="100%" viewBox="0 0 240 80"><rect/></svg>');
    const node = svgNode(el) as { width: number };
    expect(node.width).toBe(240);
    // Written back so pdfmake's own measurement agrees.
    expect(el.getAttribute("width")).toBe("240");
    expect(el.getAttribute("height")).toBe("80");
  });

  it("scales a tall diagram down to fit the page height", () => {
    // 400 wide fits, but 1600 tall does not: scaling is driven by the height.
    const node = svgNode(svgEl('<svg viewBox="0 0 400 1600"><rect/></svg>')) as { width: number };
    expect(node.width).toBeCloseTo(400 * (CONTENT_HEIGHT / 1600), 5);
    expect(node.width).toBeLessThan(CONTENT_WIDTH);
  });

  it("falls back to the content width with no usable size", () => {
    const node = svgNode(svgEl("<svg><rect/></svg>")) as { width: number };
    expect(node.width).toBe(CONTENT_WIDTH);
  });

  it("ignores an unparseable width attribute and falls through to the viewBox", () => {
    const node = svgNode(svgEl('<svg width="auto" viewBox="0 0 64 32"><rect/></svg>')) as {
      width: number;
    };
    expect(node.width).toBe(64);
  });

  it("ignores a degenerate viewBox (zero or non-numeric width or height)", () => {
    const zero = svgNode(svgEl('<svg viewBox="0 0 0 80"><rect/></svg>')) as { width: number };
    expect(zero.width).toBe(CONTENT_WIDTH);
    const junk = svgNode(svgEl('<svg viewBox="0 0 abc 80"><rect/></svg>')) as { width: number };
    expect(junk.width).toBe(CONTENT_WIDTH);
    // A usable width with an unusable height is no aspect ratio at all.
    const flat = svgNode(svgEl('<svg viewBox="0 0 240 0"><rect/></svg>')) as { width: number };
    expect(flat.width).toBe(CONTENT_WIDTH);
  });

  it("passes a mounted element through so pdfmake resolves its CSS", () => {
    // A diagram mounted in the live document must reach pdfmake as an element:
    // that is what switches its renderer to getComputedStyle, which is the only
    // way Mermaid's descendant style rules survive into the PDF.
    const host = document.createElement("div");
    host.innerHTML = '<svg width="120" height="60"><rect/></svg>';
    document.body.appendChild(host);
    try {
      const node = svgNode(host.querySelector("svg")!) as { svg: unknown; width: number };
      expect(node.svg).toBeInstanceOf(Element);
      expect(node.width).toBe(120);
    } finally {
      host.remove();
    }
    // The same element, once detached, has no computed style and goes as markup.
    const detached = svgNode(svgEl('<svg width="120" height="60"><rect/></svg>')) as {
      svg: unknown;
    };
    expect(typeof detached.svg).toBe("string");
  });

  it("keeps an existing xmlns untouched", () => {
    const node = svgNode(
      svgEl('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><g/></svg>'),
    ) as { svg: string };
    expect(node.svg.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
  });
});

/** A TrueType font rewrapped as WOFF with every table deflated, as D2 embeds its fonts. */
function ttfToWoff(ttf: Uint8Array): Uint8Array {
  const view = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const tables = Array.from({ length: view.getUint16(4) }, (_, i): WoffTable => {
    const record = 12 + 16 * i;
    const offset = view.getUint32(record + 8);
    return {
      tag: String.fromCharCode(...ttf.subarray(record, record + 4)),
      data: ttf.subarray(offset, offset + view.getUint32(record + 12)),
      compress: true,
      checksum: view.getUint32(record + 4),
    };
  });
  return buildWoff(tables, "wOFF", view.getUint32(0));
}

// The fonts a PDF of a drawing embeds, by PostScript name: one SVG whose text
// asks for a font it embeds with this data.
async function drawingFonts(mime: string, font: Uint8Array): Promise<string[]> {
  const markup =
    '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="40">' +
    `<style>@font-face { font-family: Hand; src: url(data:${mime};base64,${bytesToBase64(font)}); }</style>` +
    '<text x="4" y="30" style="font-family: Hand, sans-serif">label</text></svg>';
  // Parsed as XML (happy-dom's HTML parser drops a <style> inside <svg>) and
  // mounted, as the export mounts its diagrams. The family is an inline style:
  // happy-dom's computed style ignores the presentation attribute.
  const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
  document.body.append(svg);
  try {
    const node = svgNode(svg);
    await embeddedFontsReady();
    const buffer = await pdfEngine()
      .createPdf({ content: [node] })
      .getBuffer();
    const pdf = new TextDecoder("latin1").decode(buffer);
    return [
      ...new Set(Array.from(pdf.matchAll(/\/BaseFont \/[A-Z]{6}\+([\w-]+)/g), (match) => match[1])),
    ];
  } finally {
    svg.remove();
  }
}

describe("svgNode embedded fonts", () => {
  const robotoItalic = base64ToBytes(vfs["Roboto-Italic.ttf"]);

  it("draws SVG text in a WOFF font the SVG embeds", async () => {
    expect(await drawingFonts("font/woff", ttfToWoff(robotoItalic))).toEqual(["Roboto-Italic"]);
  });

  it("keeps the default font for a WOFF2 font, whose glyphs would draw empty", async () => {
    const woff2 = robotoItalic.slice(0, 64);
    woff2.set(new TextEncoder().encode("wOF2"));
    expect(await drawingFonts("font/woff2", woff2)).toEqual(["Roboto-Regular"]);
  });
});
