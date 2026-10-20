import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_CSS, PRESET_IDS, readPreset } from "./presets";

// Vitest does not process CSS, so the stylesheets are read from disk.
const read = (file: string) => readFileSync(path.join(process.cwd(), file), "utf-8");

const customProperties = (block: string) =>
  [...block.matchAll(/(--[\w-]+)\s*:/g)].map(([, name]) => name).sort();

/** Each top-level rule's selector, mapped to the custom properties it sets. */
function rules(css: string): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const [, selector, body] of css.matchAll(/^([^\s{}][^{}\n]*?)\s*\{([^}]*)\}/gm)) {
    found.set(selector, customProperties(body));
  }
  return found;
}

const appRules = rules(read("src/styles/app.css"));

describe("theme presets", () => {
  it("lists None first, then every preset it ships", () => {
    expect(PRESET_IDS).toEqual(["none", "sepia", "solarized", "high-contrast"]);
  });

  it.each(Object.keys(PRESET_CSS))(
    "%s sets every token the app's light and dark themes set, and nothing else",
    (preset) => {
      const presetRules = rules(read(`src/plugins/core/theme-presets/${preset}.css`));
      // The sidebar is translucent only on macOS (platform.css); tinting it
      // anywhere else would let the document show through a sidebar drawer.
      expect(presetRules).toEqual(
        new Map([
          [":root", appRules.get(":root")],
          [":root.dark", appRules.get(".dark")],
          [':root[data-platform="macos"]', ["--glyph-sidebar-bg"]],
          [':root.dark[data-platform="macos"]', ["--glyph-sidebar-bg"]],
        ]),
      );
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
