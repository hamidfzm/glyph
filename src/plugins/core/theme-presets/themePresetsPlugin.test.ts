import { fireEvent, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { GlyphPluginContext, MountContribution } from "@/lib/plugins/types";
import { PRESET_IDS, type PresetId } from "./presets";
import plugin from "./themePresetsPlugin";

// Vitest does not process CSS, so each preset gets a stand-in stylesheet.
vi.mock("./presets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./presets")>()),
  PRESET_CSS: { sepia: "sepia-css", solarized: "solarized-css", "high-contrast": "contrast-css" },
}));

function fakeContext(stored: Record<string, unknown>) {
  const values = { ...stored };
  const sheets: string[] = [];
  const panels: MountContribution[] = [];
  return {
    sheets,
    panels,
    registerTranslations: vi.fn(),
    i18n: { t: (key: string) => key, onLanguageChange: vi.fn() },
    settings: {
      get: (key: string) => values[key],
      set: vi.fn((key: string, value: unknown) => {
        values[key] = value;
      }),
    },
    ui: {
      addStyles: vi.fn((css: string) => {
        sheets.push(css);
        return () => {
          sheets.splice(sheets.indexOf(css), 1);
        };
      }),
      addSettingsPanel: vi.fn((panel: MountContribution) => {
        panels.push(panel);
        return () => {};
      }),
    },
  };
}

async function activate(stored: Record<string, unknown> = {}) {
  const ctx = fakeContext(stored);
  await plugin.activate(ctx as unknown as GlyphPluginContext);
  const openPicker = () => {
    const el = document.createElement("div");
    ctx.panels[0].mount(el, () => {});
    return within(el).getByRole<HTMLSelectElement>("combobox", {
      name: /glyph\.core\.theme-presets:label/,
    });
  };
  return { ctx, openPicker };
}

const pick = (select: HTMLSelectElement, preset: PresetId) =>
  fireEvent.change(select, { target: { value: preset } });

describe("Theme presets core plugin", () => {
  it("leaves the app's look alone until a preset is picked", async () => {
    const { ctx, openPicker } = await activate();

    expect(ctx.sheets).toEqual([]);
    expect(ctx.panels).toHaveLength(1);
    expect(openPicker().value).toBe("none");
  });

  it("applies the stored preset when it loads", async () => {
    const { ctx, openPicker } = await activate({ preset: "solarized" });

    expect(ctx.sheets).toEqual(["solarized-css"]);
    expect(openPicker().value).toBe("solarized");
  });

  it("switches presets live, one stylesheet at a time, and stores the choice", async () => {
    const { ctx, openPicker } = await activate();
    const picker = openPicker();

    pick(picker, "sepia");
    expect(ctx.sheets).toEqual(["sepia-css"]);
    expect(ctx.settings.set).toHaveBeenLastCalledWith("preset", "sepia");

    pick(picker, "high-contrast");
    expect(ctx.sheets).toEqual(["contrast-css"]);

    pick(picker, "none");
    expect(ctx.sheets).toEqual([]);
    expect(ctx.settings.set).toHaveBeenLastCalledWith("preset", "none");
  });

  it("opens the picker on the preset picked since it loaded", async () => {
    const { openPicker } = await activate();
    pick(openPicker(), "sepia");

    expect(openPicker().value).toBe("sepia");
  });

  it("treats a stored preset it does not ship as None", async () => {
    const { ctx, openPicker } = await activate({ preset: "neon" });

    expect(ctx.sheets).toEqual([]);
    expect(openPicker().value).toBe("none");
  });

  it("names every preset in all five locales", async () => {
    const { ctx } = await activate();
    const calls = ctx.registerTranslations.mock.calls;

    expect(calls.map(([locale, namespace]) => [locale, namespace])).toEqual([
      ["en", "glyph.core.theme-presets"],
      ["de", "glyph.core.theme-presets"],
      ["es", "glyph.core.theme-presets"],
      ["fa", "glyph.core.theme-presets"],
      ["zh", "glyph.core.theme-presets"],
    ]);
    for (const [, , resources] of calls) {
      expect(Object.keys(resources).sort()).toEqual(["label", "presets"]);
      expect(Object.keys(resources.presets).sort()).toEqual([...PRESET_IDS].sort());
    }
  });
});
