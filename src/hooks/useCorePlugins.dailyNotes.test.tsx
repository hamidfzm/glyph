import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { CORE_PLUGINS } from "@/lib/plugins/corePlugins";
import { createPluginHost } from "@/lib/plugins/host";
import { type CorePluginSettings, DEFAULT_SETTINGS } from "@/lib/settings";
import { useCorePlugins } from "./useCorePlugins";

// The real daily notes plugin against the real host: a command and a Workspace
// Settings tab, there only while its setting is on.

const ALL_OFF = Object.fromEntries(
  Object.keys(DEFAULT_SETTINGS.corePlugins).map((key) => [key, false]),
) as unknown as CorePluginSettings;

function settingsValue(dailyNotes: boolean): SettingsContextValue {
  return {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...ALL_OFF, dailyNotes } },
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
  const contributions = () => ({
    commands: host.commands.list().map((command) => `${command.pluginId}/${command.id}`),
    tabs: host.workspaceSettingsPanels.list().map((panel) => `${panel.pluginId}/${panel.id}`),
  });
  return { ...view, host, setSettings, contributions };
}

const ON = {
  commands: ["glyph.core.daily-notes/open-today"],
  tabs: ["glyph.core.daily-notes/settings"],
};
const OFF = { commands: [], tabs: [] };

afterEach(() => vi.restoreAllMocks());

describe("daily notes core plugin lifecycle", () => {
  it("loads none of its code while it is off", async () => {
    const daily = CORE_PLUGINS.find((core) => core.settingsKey === "dailyNotes");
    if (!daily) throw new Error("daily notes core plugin missing");
    const load = vi.spyOn(daily, "load");
    const { result, contributions } = renderCore(settingsValue(false));

    await waitFor(() => expect(result.current).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(contributions()).toEqual(OFF);
  });

  it("adds its command and its Workspace Settings tab when on", async () => {
    const { host, contributions } = renderCore(settingsValue(true));

    await waitFor(() => expect(contributions()).toEqual(ON));
    expect(host.commands.list()[0]).toMatchObject({
      menu: "file",
      shortcut: "CmdOrCtrl+Shift+T",
      when: "workspace",
    });
  });

  it("follows its toggle at runtime, with no restart", async () => {
    const { host, setSettings, contributions } = renderCore(settingsValue(true));
    await waitFor(() => expect(contributions()).toEqual(ON));

    act(() => setSettings(settingsValue(false)));
    expect(contributions()).toEqual(OFF);
    expect(host.listLoaded()).toEqual([]);

    act(() => setSettings(settingsValue(true)));
    await waitFor(() => expect(contributions()).toEqual(ON));
  });
});
