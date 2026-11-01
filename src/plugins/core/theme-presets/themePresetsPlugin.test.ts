import { describe, expect, it, vi } from "vitest";
import type { ColorSchemeContribution, GlyphPluginContext } from "@/lib/plugins/types";
import { PRESET_CSS } from "./presets";
import plugin from "./themePresetsPlugin";

// Vitest does not process CSS, so each preset gets a stand-in stylesheet.
vi.mock("./presets", () => ({
  PRESET_CSS: { sepia: "sepia-css", solarized: "solarized-css", "high-contrast": "contrast-css" },
}));

function fakeContext() {
  const schemes: ColorSchemeContribution[] = [];
  return {
    schemes,
    registerTranslations: vi.fn(),
    i18n: { t: (key: string) => `[${key}]`, onLanguageChange: vi.fn() },
    ui: {
      addColorScheme: vi.fn((scheme: ColorSchemeContribution) => {
        schemes.push(scheme);
        return () => {
          schemes.splice(schemes.indexOf(scheme), 1);
        };
      }),
    },
  };
}

async function activate() {
  const ctx = fakeContext();
  await plugin.activate(ctx as unknown as GlyphPluginContext);
  return ctx;
}

describe("Theme presets core plugin", () => {
  it("offers each preset as a color scheme, named in the current language", async () => {
    const ctx = await activate();

    expect(ctx.schemes).toEqual([
      { id: "sepia", label: "[glyph.core.theme-presets:presets.sepia]", css: "sepia-css" },
      {
        id: "solarized",
        label: "[glyph.core.theme-presets:presets.solarized]",
        css: "solarized-css",
      },
      {
        id: "high-contrast",
        label: "[glyph.core.theme-presets:presets.high-contrast]",
        css: "contrast-css",
      },
    ]);
  });

  it("names every preset in all five locales", async () => {
    const ctx = await activate();
    const calls = ctx.registerTranslations.mock.calls;

    expect(calls.map(([locale, namespace]) => [locale, namespace])).toEqual([
      ["en", "glyph.core.theme-presets"],
      ["de", "glyph.core.theme-presets"],
      ["es", "glyph.core.theme-presets"],
      ["fa", "glyph.core.theme-presets"],
      ["zh", "glyph.core.theme-presets"],
    ]);
    for (const [, , resources] of calls) {
      expect(Object.keys(resources)).toEqual(["presets"]);
      expect(Object.keys(resources.presets).sort()).toEqual(Object.keys(PRESET_CSS).sort());
    }
  });
});
