import { describe, expect, it } from "vitest";
import { tagHue } from "./tagColor";

describe("tagHue", () => {
  it("returns the same hue for the same tag", () => {
    expect(tagHue("markdown")).toBe(tagHue("markdown"));
  });

  it("returns different hues for different tags (sample)", () => {
    expect(tagHue("markdown")).not.toBe(tagHue("demo"));
  });

  it("stays within the 0–359 range", () => {
    for (const tag of ["", "a", "demo", "really-long-tag-name", "🎨", "测试"]) {
      const h = tagHue(tag);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(360);
    }
  });
});
