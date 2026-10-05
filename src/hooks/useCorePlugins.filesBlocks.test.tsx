import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { pluginAppState, setPluginAppState } from "@/lib/plugins/appState";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { vaultSnapshot } from "@/test/tabsHarness";
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
  const host = createPluginHost(vi.fn(), undefined, () => pluginAppState().workspaceRoot);
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

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue([]);
  setPluginAppState({ workspaceRoot: null, activeDocument: null, snapshot: EMPTY_SNAPSHOT });
});

afterEach(() => vi.restoreAllMocks());

describe("core plugins with Files panel blocks", () => {
  it("imports none of them while they are all off", async () => {
    const loads = CORE_PLUGINS.map((core) => vi.spyOn(core, "load"));
    const { result, blocks } = renderCore(settingsValue({}));

    await waitFor(() => expect(result.current).toBe(true));
    for (const load of loads) expect(load).not.toHaveBeenCalled();
    expect(blocks()).toEqual([]);
  });

  describe.each([
    { key: "tags", block: "glyph.core.tags:tags" },
    { key: "backlinks", block: "glyph.core.backlinks:backlinks" },
  ] as const)("$key", ({ key, block }) => {
    it("adds its block when on, and imports no other plugin for it", async () => {
      const loads = new Map(CORE_PLUGINS.map((core) => [core.settingsKey, vi.spyOn(core, "load")]));
      const { blocks } = renderCore(settingsValue({ [key]: true }));

      await waitFor(() => expect(blocks()).toEqual([block]));
      for (const [settingsKey, load] of loads) {
        expect(load, settingsKey).toHaveBeenCalledTimes(settingsKey === key ? 1 : 0);
      }
    });

    it("follows its toggle at runtime, with no restart", async () => {
      const { host, setSettings, blocks } = renderCore(settingsValue({ [key]: true }));
      await waitFor(() => expect(blocks()).toEqual([block]));

      act(() => setSettings(settingsValue({})));
      expect(blocks()).toEqual([]);
      expect(host.styles.list()).toEqual([]);
      expect(host.listLoaded()).toEqual([]);

      act(() => setSettings(settingsValue({ [key]: true })));
      await waitFor(() => expect(blocks()).toEqual([block]));
    });
  });

  // A listener left behind would keep querying the index for a plugin the
  // user turned off.
  it("stops backlinks asking the index once it is switched off", async () => {
    const mirrored = {
      workspaceRoot: "/ws",
      activeDocument: { path: "/ws/a.md", text: "" },
      snapshot: vaultSnapshot(["/ws/a.md"]),
    };
    setPluginAppState(mirrored);
    const { setSettings, blocks } = renderCore(settingsValue({ backlinks: true }));
    await waitFor(() => expect(blocks()).toHaveLength(1));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("vault_backlinks", { root: "/ws", path: "/ws/a.md" }),
    );

    // Still listening while on: an index change asks again.
    const whileOn = vi.mocked(invoke).mock.calls.length;
    act(() => setPluginAppState({ ...mirrored, snapshot: vaultSnapshot(["/ws/a.md"]) }));
    expect(vi.mocked(invoke).mock.calls.length).toBeGreaterThan(whileOn);

    act(() => setSettings(settingsValue({})));
    const afterOff = vi.mocked(invoke).mock.calls.length;
    act(() =>
      setPluginAppState({
        workspaceRoot: "/ws",
        activeDocument: { path: "/ws/b.md", text: "" },
        snapshot: vaultSnapshot(["/ws/a.md", "/ws/b.md"]),
      }),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(afterOff);
  });
});
