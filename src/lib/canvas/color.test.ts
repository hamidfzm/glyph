import { describe, expect, it } from "vitest";
import { canvasColorToCss, isPresetColor, PRESET_COLORS } from "./color";

describe("canvasColorToCss", () => {
  it("returns undefined when no colour is set", () => {
    expect(canvasColorToCss(undefined)).toBeUndefined();
  });

  it("maps a preset index to a themeable custom property with a fallback", () => {
    expect(canvasColorToCss("1")).toBe("var(--glyph-canvas-color-1, #fb464c)");
    expect(canvasColorToCss("6")).toBe("var(--glyph-canvas-color-6, #a882ff)");
  });

  it("passes a hex colour through unchanged", () => {
    expect(canvasColorToCss("#123456")).toBe("#123456");
  });
});

describe("isPresetColor", () => {
  it("distinguishes presets from hex values", () => {
    expect(isPresetColor("3")).toBe(true);
    expect(isPresetColor("#fff")).toBe(false);
    expect(isPresetColor(undefined)).toBe(false);
  });
});

describe("PRESET_COLORS", () => {
  it("exposes the six preset keys in order", () => {
    expect(PRESET_COLORS).toEqual(["1", "2", "3", "4", "5", "6"]);
  });
});
