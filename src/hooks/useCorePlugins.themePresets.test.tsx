import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { i18n, registerTranslations } from "@/lib/i18n";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { legacyPresetScheme } from "@/lib/themePresetMigration";
import { preloadCorePlugins } from "@/test/preloadCorePlugins";
import { useCorePlugins } from "./useCorePlugins";

// The real theme presets plugin against the real host: its color schemes,
// offered only while it is on.

preloadCorePlugins("themePresets");

const ID = "glyph.core.theme-presets";
const KEYS = [`${ID}:sepia`, `${ID}:solarized`, `${ID}:high-contrast`];

const ALL_OFF = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS.corePlugins).map((key) => [key, false]),
) as unknown as CorePluginSettings;

function settingsValue(themePresets: boolean): SettingsContextValue {
  return {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...ALL_OFF, themePresets } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
}

function renderCore(initial: SettingsContextValue) {
  const host = createPluginHost(vi.fn(), registerTranslations);
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = renderHook(() => useCorePlugins(host, vi.fn()), { wrapper });
  const setSettings = (next: SettingsContextValue) => {
    value = next;
    view.rerender();
  };
  const schemeKeys = () => host.colorSchemes.list().map((scheme) => scheme.key);
  return { ...view, host, setSettings, schemeKeys };
}

afterEach(() => vi.restoreAllMocks());

describe("theme presets core plugin lifecycle", () => {
  it("loads none of its code while it is off", async () => {
    const presets = CORE_PLUGINS.find((core) => core.settingsKey === "themePresets");
    if (!presets) throw new Error("theme presets core plugin missing");
    const load = vi.spyOn(presets, "load");
    const { result, schemeKeys } = renderCore(settingsValue(false));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(schemeKeys()).toEqual([]);
  });

  it("offers its schemes under the keys a carried-over preset is stored as", async () => {
    const { host, schemeKeys } = renderCore(settingsValue(true));

    await waitFor(() => expect(schemeKeys()).toEqual(KEYS));
    expect(host.colorSchemes.list().map((scheme) => scheme.label)).toEqual([
      "Sepia",
      "Solarized",
      "High contrast",
    ]);
    for (const preset of ["sepia", "solarized", "high-contrast"]) {
      expect(schemeKeys()).toContain(legacyPresetScheme({ preset })?.id);
    }
    // Nothing applies until the user picks a scheme in Appearance.
    expect(host.styles.list()).toEqual([]);
    expect(host.settingsPanels.list()).toEqual([]);
  });

  it("follows its toggle at runtime, with no restart", async () => {
    const { host, setSettings, schemeKeys } = renderCore(settingsValue(true));
    await waitFor(() => expect(schemeKeys()).toEqual(KEYS));

    act(() => setSettings(settingsValue(false)));
    expect(schemeKeys()).toEqual([]);
    expect(host.listLoaded()).toEqual([]);

    act(() => setSettings(settingsValue(true)));
    await waitFor(() => expect(schemeKeys()).toEqual(KEYS));
  });

  it("renames its schemes on a language switch without ever dropping one", async () => {
    const { host, schemeKeys } = renderCore(settingsValue(true));
    await waitFor(() => expect(schemeKeys()).toEqual(KEYS));
    const gaps: string[][] = [];
    const unsubscribe = host.colorSchemes.subscribe(() => {
      const missing = KEYS.filter((key) => !schemeKeys().includes(key));
      if (missing.length > 0) gaps.push(missing);
    });

    const language = i18n.language;
    try {
      await act(() => i18n.changeLanguage("de"));
      const labels = host.colorSchemes.list().map((scheme) => scheme.label);
      expect(labels).toEqual(["Sepia", "Solarized", "Hoher Kontrast"]);
    } finally {
      await act(() => i18n.changeLanguage(language));
      unsubscribe();
    }
    expect(gaps).toEqual([]);
    expect(schemeKeys()).toEqual(KEYS);
  });
});
