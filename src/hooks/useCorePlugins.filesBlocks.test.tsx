import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { useCorePlugins } from "./useCorePlugins";

// The real tags and backlinks plugins against the real host: each is one block
// in the Files panel, there only while its setting is on.

const ALL_OFF = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS.corePlugins).map((key) => [key, false]),
) as unknown as CorePluginSettings;

function settingsValue(on: Partial<CorePluginSettings>): SettingsContextValue {
  return {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...ALL_OFF, ...on } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
}

function renderCore(initial: SettingsContextValue) {
  const host = createPluginHost(vi.fn());
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const view = renderHook(() => useCorePlugins(host, vi.fn()), { wrapper });
  const setSettings = (next: SettingsContextValue) => {
    value = next;
    view.rerender();
  };
  const blocks = () =>
    host.sidebarPanels
      .list()
      .filter((panel) => panel.location === "files")
      .map((panel) => `${panel.pluginId}:${panel.id}`);
  return { ...view, host, setSettings, blocks };
}

afterEach(() => vi.restoreAllMocks());

describe.each([
  { key: "tags", block: "glyph.core.tags:tags" },
  { key: "backlinks", block: "glyph.core.backlinks:backlinks" },
] as const)("the $key core plugin", ({ key, block }) => {
  it("is never imported while it is off", async () => {
    const loads = CORE_PLUGINS.map((core) => vi.spyOn(core, "load"));
    const { result, blocks } = renderCore(settingsValue({}));

    await waitFor(() => expect(result.current).toBe(true));
    for (const load of loads) expect(load).not.toHaveBeenCalled();
    expect(blocks()).toEqual([]);
  });

  it("adds its block when on, and imports no other plugin for it", async () => {
    const loads = new Map(CORE_PLUGINS.map((core) => [core.settingsKey, vi.spyOn(core, "load")]));
    const { blocks } = renderCore(settingsValue({ [key]: true }));

    await waitFor(() => expect(blocks()).toEqual([block]));
    for (const [settingsKey, load] of loads) {
      expect(load, settingsKey).toHaveBeenCalledTimes(settingsKey === key ? 1 : 0);
    }
  });

  it("follows its toggle at runtime, leaving nothing behind when turned off", async () => {
    const { host, setSettings, blocks } = renderCore(settingsValue({ [key]: true }));
    await waitFor(() => expect(blocks()).toEqual([block]));

    act(() => setSettings(settingsValue({})));
    expect(blocks()).toEqual([]);
    expect(host.styles.list()).toEqual([]);
    expect(host.fileTreeFilters.list()).toEqual([]);
    expect(host.listLoaded()).toEqual([]);

    act(() => setSettings(settingsValue({ [key]: true })));
    await waitFor(() => expect(blocks()).toEqual([block]));
  });
});
