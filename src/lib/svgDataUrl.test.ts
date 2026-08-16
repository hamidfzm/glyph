import { describe, expect, it } from "vitest";
import { decodeSvgDataUrl, svgToDataUrl, toXmlSvg } from "./svgDataUrl";

const decode = (url: string) => decodeURIComponent(url.slice("data:image/svg+xml,".length));

describe("svgToDataUrl", () => {
  it("wraps markup in an svg data URL", () => {
    const url = svgToDataUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decode(url)).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it("encodes characters that would break the URL", () => {
    const url = svgToDataUrl("<svg><text>a&b #c</text></svg>");
    expect(url).not.toContain("#");
    expect(url).toContain("%23");
  });

  it("injects the SVG namespace when missing (so it renders as an <img>)", () => {
    // D2/Mermaid SVGs come back without xmlns; a data-URL <img> needs it.
    expect(decode(svgToDataUrl("<svg><rect/></svg>"))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>',
    );
  });
});

describe("toXmlSvg", () => {
  // The lightbox bug: a Mermaid flowchart label written as `A["one<br/>two"]`
  // renders as HTML inside a `<foreignObject>`, where the break comes out as a
  // bare `<br>`. An `<img>` parses the data URL as XML, so the unclosed tag
  // fails the whole document and the diagram renders blank.
  it("closes a bare <br> that would fail an XML parse", () => {
    const xml = toXmlSvg("<svg><foreignObject><p>one<br>two</p></foreignObject></svg>");
    expect(xml).not.toMatch(/<br(?!\s*\/)>/);
    expect(new DOMParser().parseFromString(xml, "image/svg+xml").querySelector("parsererror")).toBe(
      null,
    );
  });

  it("preserves camelCased SVG attributes", () => {
    expect(toXmlSvg('<svg viewBox="0 0 10 10"><rect/></svg>')).toContain('viewBox="0 0 10 10"');
  });

  it("adds the SVG namespace and keeps an existing one", () => {
    const ns = 'xmlns="http://www.w3.org/2000/svg"';
    expect(toXmlSvg("<svg><g/></svg>")).toContain(ns);
    expect(toXmlSvg(`<svg ${ns}><g/></svg>`)).toBe(`<svg ${ns}><g/></svg>`);
  });

  it("returns the input untouched when there is no svg root", () => {
    expect(toXmlSvg("not markup")).toBe("not markup");
  });
});

describe("decodeSvgDataUrl", () => {
  it("round-trips a URI-encoded svg data URL", () => {
    const svg = "<svg><text>a&b #c</text></svg>";
    expect(decodeSvgDataUrl(svgToDataUrl(svg))).toBe(toXmlSvg(svg));
  });

  it("decodes a base64 svg data URL", () => {
    const svg = "<svg><rect/></svg>";
    expect(decodeSvgDataUrl(`data:image/svg+xml;base64,${btoa(svg)}`)).toBe(svg);
  });

  it("returns null for non-SVG data URLs and malformed input", () => {
    expect(decodeSvgDataUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(decodeSvgDataUrl("data:image/svg+xml")).toBeNull(); // no comma
    expect(decodeSvgDataUrl("data:image/svg+xml,%")).toBeNull(); // bad URI encoding
    expect(decodeSvgDataUrl("https://example.com/x.svg")).toBeNull();
  });
});
