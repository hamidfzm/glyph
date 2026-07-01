import { describe, expect, it } from "vitest";
import { decodeSvgDataUrl, ensureSvgXmlns, svgToDataUrl } from "./svgDataUrl";

describe("svgToDataUrl", () => {
  it("wraps markup in an svg data URL", () => {
    const url = svgToDataUrl('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(url.startsWith("data:image/svg+xml,")).toBe(true);
    expect(decodeURIComponent(url.slice("data:image/svg+xml,".length))).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    );
  });

  it("encodes characters that would break the URL", () => {
    const url = svgToDataUrl("<svg><text>a&b #c</text></svg>");
    expect(url).not.toContain("#");
    expect(url).toContain("%23");
  });

  it("injects the SVG namespace when missing (so it renders as an <img>)", () => {
    // D2/Mermaid SVGs come back without xmlns; a data-URL <img> needs it.
    const decoded = decodeURIComponent(
      svgToDataUrl("<svg><rect/></svg>").slice("data:image/svg+xml,".length),
    );
    expect(decoded).toBe('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
  });

  it("leaves an existing namespace untouched", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const decoded = decodeURIComponent(svgToDataUrl(svg).slice("data:image/svg+xml,".length));
    expect(decoded).toBe(svg);
  });
});

describe("ensureSvgXmlns", () => {
  it("adds the namespace only when absent", () => {
    expect(ensureSvgXmlns("<svg><g/></svg>")).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>',
    );
    const withNs = '<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>';
    expect(ensureSvgXmlns(withNs)).toBe(withNs);
  });
});

describe("decodeSvgDataUrl", () => {
  it("round-trips a URI-encoded svg data URL", () => {
    const svg = "<svg><text>a&b #c</text></svg>";
    expect(decodeSvgDataUrl(svgToDataUrl(svg))).toBe(ensureSvgXmlns(svg));
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
