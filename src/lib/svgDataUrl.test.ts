import { describe, expect, it } from "vitest";
import { svgToDataUrl } from "./svgDataUrl";

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
});
