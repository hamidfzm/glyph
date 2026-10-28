import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginSettings, savePluginSettings } from "@/lib/plugins/settingsStore";
import {
  carriedOverColorScheme,
  legacyPresetScheme,
  removeLegacyPreset,
} from "@/lib/themePresetMigration";

vi.mock("@/lib/plugins/settingsStore", () => ({
  loadPluginSettings: vi.fn(),
  savePluginSettings: vi.fn(async () => {}),
}));

const PLUGIN = "glyph.core.theme-presets";

beforeEach(() => {
  vi.mocked(loadPluginSettings).mockReset();
  vi.mocked(savePluginSettings).mockClear();
});

describe("legacyPresetScheme", () => {
  it.each([
    ["sepia", "Sepia"],
    ["solarized", "Solarized"],
    ["high-contrast", "High contrast"],
  ])("carries %s over", (preset, label) => {
    expect(legacyPresetScheme({ preset })).toEqual({ id: `${PLUGIN}:${preset}`, label });
  });

  it.each([undefined, null, 42, "", "none", "neon", "Sepia", "toString", ["sepia"]])(
    "carries nothing over for %j",
    (preset) => {
      expect(legacyPresetScheme({ preset })).toBeNull();
    },
  );
});

describe("carriedOverColorScheme", () => {
  it("reads the plugin's preset while the settings have no color scheme", async () => {
    vi.mocked(loadPluginSettings).mockResolvedValue({ preset: "solarized" });

    expect(await carriedOverColorScheme(undefined)).toEqual({
      id: `${PLUGIN}:solarized`,
      label: "Solarized",
    });
    expect(await carriedOverColorScheme({ appearance: { theme: "dark" } })).not.toBeNull();
    expect(loadPluginSettings).toHaveBeenCalledWith(PLUGIN);
  });

  it("changes nothing once the settings hold a color scheme", async () => {
    vi.mocked(loadPluginSettings).mockResolvedValue({ preset: "solarized" });
    const stored = { appearance: { colorScheme: { id: "default", label: "" } } };

    expect(await carriedOverColorScheme(stored)).toBeNull();
    expect(loadPluginSettings).not.toHaveBeenCalled();
  });
});

describe("removeLegacyPreset", () => {
  it("drops only the preset from the plugin's stored settings", async () => {
    vi.mocked(loadPluginSettings).mockResolvedValue({ preset: "sepia", other: 1 });

    await removeLegacyPreset();

    expect(savePluginSettings).toHaveBeenCalledWith(PLUGIN, { other: 1 });
  });
});
