import { act, fireEvent, renderHook, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost, type PluginSettingsBackend } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { preloadCorePlugins } from "@/test/preloadCorePlugins";
import { useCorePlugins } from "./useCorePlugins";

// The real theme presets plugin against the real host: a picker under its
// Settings row and the picked preset's stylesheet, there only while it is on.

preloadCorePlugins("themePresets");

const ID = "glyph.core.theme-presets";

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

/** Plugin settings kept in memory, the way plugins.json keeps them across restarts. */
function memoryBackend(
  stored: Record<string, Record<string, unknown>> = {},
): PluginSettingsBackend {
  return {
    load: async (pluginId) => ({ ...stored[pluginId] }),
    save: (pluginId, key, value) => {
      stored[pluginId] = { ...stored[pluginId], [key]: value };
    },
  };
}

function renderCore(initial: SettingsContextValue, backend = memoryBackend()) {
  const host = createPluginHost(vi.fn(), undefined, undefined, backend);
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = renderHook(() => useCorePlugins(host, vi.fn()), { wrapper });
  const setSettings = (next: SettingsContextValue) => {
    value = next;
    view.rerender();
  };
  const contributions = () => ({
    panels: host.settingsPanels.list().map((panel) => `${panel.pluginId}/${panel.id}`),
    sheets: host.styles.list().length,
  });
  const openPicker = () => {
    const el = document.createElement("div");
    host.settingsPanels.list()[0].mount(el, () => {});
    return within(el).getByRole<HTMLSelectElement>("combobox");
  };
  return { ...view, host, setSettings, contributions, openPicker };
}

afterEach(() => vi.restoreAllMocks());

describe("theme presets core plugin lifecycle", () => {
  it("loads none of its code while it is off", async () => {
    const presets = CORE_PLUGINS.find((core) => core.settingsKey === "themePresets");
    if (!presets) throw new Error("theme presets core plugin missing");
    const load = vi.spyOn(presets, "load");
    const { result, contributions } = renderCore(settingsValue(false));

    await waitFor(() => expect(result.current).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(contributions()).toEqual({ panels: [], sheets: 0 });
  });

  it("adds its picker when on, and no stylesheet until a preset is picked", async () => {
    const { contributions } = renderCore(settingsValue(true));

    await waitFor(() => expect(contributions()).toEqual({ panels: [`${ID}/preset`], sheets: 0 }));
  });

  it("applies the preset picked in an earlier run", async () => {
    const backend = memoryBackend({ [ID]: { preset: "sepia" } });
    const { contributions, openPicker } = renderCore(settingsValue(true), backend);

    await waitFor(() => expect(contributions()).toEqual({ panels: [`${ID}/preset`], sheets: 1 }));
    expect(openPicker().value).toBe("sepia");
  });

  it("follows its toggle at runtime, with no restart, and keeps the picked preset", async () => {
    const { host, setSettings, contributions, openPicker } = renderCore(settingsValue(true));
    await waitFor(() => expect(contributions().panels).toHaveLength(1));

    fireEvent.change(openPicker(), { target: { value: "high-contrast" } });
    expect(contributions().sheets).toBe(1);

    act(() => setSettings(settingsValue(false)));
    expect(contributions()).toEqual({ panels: [], sheets: 0 });
    expect(host.listLoaded()).toEqual([]);

    act(() => setSettings(settingsValue(true)));
    await waitFor(() => expect(contributions()).toEqual({ panels: [`${ID}/preset`], sheets: 1 }));
    expect(openPicker().value).toBe("high-contrast");
  });
});
