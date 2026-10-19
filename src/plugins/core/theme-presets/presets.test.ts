import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_CSS, PRESET_IDS, readPreset } from "./presets";

// Vitest does not process CSS, so the stylesheets are read from disk.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf-8");

const customProperties = (block: string) =>
  [...block.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name).sort();

/** The custom properties a rule sets, for the one rule in `css` with exactly this selector. */
function ruleProperties(css: string, selector: string): string[] {
  const escaped = selector.replace(/[.[\]]/g, "\\$&");
  const rule = new RegExp(`^${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  if (!rule) throw new Error(`no ${selector} rule`);
  return customProperties(rule[1]);
}

const appCss = read("src/styles/app.css");
const lightTokens = ruleProperties(appCss, ":root");
const darkTokens = ruleProperties(appCss, ".dark");

describe("theme presets", () => {
  it("lists None first, then every preset it ships", () => {
    expect(PRESET_IDS).toEqual(["none", "sepia", "solarized", "high-contrast"]);
  });

  it.each(Object.keys(PRESET_CSS))(
    "%s sets every token the app's light and dark themes set, and nothing else",
    (preset) => {
      const css = read(`src/plugins/core/theme-presets/${preset}.css`);
      expect(ruleProperties(css, ":root")).toEqual(lightTokens);
      expect(ruleProperties(css, ":root.dark")).toEqual(darkTokens);
      // The sidebar is translucent only on macOS (platform.css); tinting it
      // anywhere else would let the document show through a sidebar drawer.
      expect(ruleProperties(css, ':root[data-platform="macos"]')).toEqual(["--glyph-sidebar-bg"]);
      expect(ruleProperties(css, ':root.dark[data-platform="macos"]')).toEqual([
        "--glyph-sidebar-bg",
      ]);
      expect(css.match(/\{/g)).toHaveLength(4);
    },
  );

  it("reads a stored preset it ships", () => {
    expect(readPreset("sepia")).toBe("sepia");
    expect(readPreset("high-contrast")).toBe("high-contrast");
    expect(readPreset("none")).toBe("none");
  });

  it("falls back to None for anything else", () => {
    for (const stored of [undefined, null, 42, "", "neon", "Sepia", "toString", ["sepia"]]) {
      expect(readPreset(stored)).toBe("none");
    }
  });
});
