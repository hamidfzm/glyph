import { describe, expect, it, vi } from "vitest";
import { registerEmbeddedFonts } from "./svgFonts";

// Names each font after its data, so a test can see which data a name points at.
vi.mock("./embeddedFonts", () => ({ embeddedFontFamily: (data: string) => `embedded-${data}` }));

// happy-dom's HTML parser drops a <style> inside <svg>; its XML parser keeps it.
function svgEl(markup: string): Element {
  const xml = markup.replace("<svg>", '<svg xmlns="http://www.w3.org/2000/svg">');
  return new DOMParser().parseFromString(xml, "image/svg+xml").documentElement;
}

const fontFace = (family: string, data: string) =>
  `@font-face { font-family: ${family}; src: url(data:font/woff;base64,${data}); }`;

describe("registerEmbeddedFonts", () => {
  it("points an Excalidraw-style font-family attribute at the embedded font", () => {
    const svg = svgEl(
      `<svg><defs><style>${fontFace("Excalifont", "AAAA")}</style></defs>` +
        '<text font-family="Excalifont, Xiaolai, Segoe UI Emoji">hi</text></svg>',
    );
    registerEmbeddedFonts(svg);
    // Families without an embedded font stay, in order.
    expect(svg.querySelector("text")?.getAttribute("font-family")).toBe(
      "embedded-AAAA, Xiaolai, Segoe UI Emoji",
    );
  });

  it("points D2-style style-sheet rules and inline styles at the embedded fonts", () => {
    const svg = svgEl(
      "<svg><style>" +
        '.d2-1 .text-bold { font-family: "d2-1-font-bold"; }\n' +
        fontFace("d2-1-font-bold", "BBBB") +
        "</style>" +
        '<text class="text-bold" style="text-anchor:middle;font-family:\'d2-1-font-bold\'">x</text></svg>',
    );
    registerEmbeddedFonts(svg);
    const css = svg.querySelector("style")?.textContent ?? "";
    expect(css).toContain(".d2-1 .text-bold { font-family: embedded-BBBB; }");
    expect(css).toContain("@font-face { font-family: embedded-BBBB;");
    expect(svg.querySelector("text")?.getAttribute("style")).toBe(
      "text-anchor:middle;font-family:embedded-BBBB",
    );
  });

  it("gives two drawings that embed one family name different data their own fonts", () => {
    const drawing = (data: string) =>
      svgEl(
        `<svg><style>${fontFace("Excalifont", data)}</style><text font-family="Excalifont">x</text></svg>`,
      );
    const first = drawing("AAAA");
    const second = drawing("CCCC");
    registerEmbeddedFonts(first);
    registerEmbeddedFonts(second);
    expect(first.querySelector("text")?.getAttribute("font-family")).toBe("embedded-AAAA");
    expect(second.querySelector("text")?.getAttribute("font-family")).toBe("embedded-CCCC");
  });

  it("matches family names case-insensitively and with or without quotes", () => {
    const svg = svgEl(
      `<svg><style>${fontFace('"Hand Drawn"', "DDDD")}</style>` +
        "<text font-family=\"'hand drawn', serif\">x</text></svg>",
    );
    registerEmbeddedFonts(svg);
    expect(svg.querySelector("text")?.getAttribute("font-family")).toBe("embedded-DDDD, serif");
  });

  it("keeps the first face of a family split across several", () => {
    const svg = svgEl(
      `<svg><style>${fontFace("Split", "EEEE")}${fontFace("Split", "FFFF")}</style>` +
        '<text font-family="Split">x</text></svg>',
    );
    registerEmbeddedFonts(svg);
    expect(svg.querySelector("text")?.getAttribute("font-family")).toBe("embedded-EEEE");
  });

  it("leaves a font behind a URL alone, so it is never fetched", () => {
    const markup =
      "<svg><style>@font-face { font-family: Remote; src: url(https://example.com/f.woff2); }</style>" +
      '<text font-family="Remote">x</text></svg>';
    const svg = svgEl(markup);
    registerEmbeddedFonts(svg);
    expect(svg.outerHTML).toBe(svgEl(markup).outerHTML);
  });

  it("leaves an SVG that embeds no usable font untouched", () => {
    // The only @font-face names no family, so nothing can ask for it.
    const markup =
      "<svg><style>.a { font-family: Roboto; }\n@font-face { src: url(data:font/woff;base64,GGGG); }</style>" +
      '<text font-family="Roboto">x</text></svg>';
    const svg = svgEl(markup);
    registerEmbeddedFonts(svg);
    expect(svg.outerHTML).toBe(svgEl(markup).outerHTML);
  });
});
