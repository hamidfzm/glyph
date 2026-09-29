import { describe, expect, it } from "vitest";
import { svgToDataUrl } from "./svgDataUrl";

describe("svgToDataUrl", () => {
  it("reserializes an SVG as XML with its namespace", () => {
    const url = svgToDataUrl("<svg><rect></rect></svg>");
    expect(decodeURIComponent(url)).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("passes markup without an svg root through as is", () => {
    expect(svgToDataUrl("<p>x</p>")).toBe(`data:image/svg+xml,${encodeURIComponent("<p>x</p>")}`);
  });
});
