import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PRESET_CSS } from "./presets";

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
});
