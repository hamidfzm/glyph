import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { createPluginHost } from "@/lib/plugins/host";
import type { PluginModule } from "@/lib/plugins/types";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { expectConsole } from "@/test/consoleGuard";
import { useCorePlugins } from "./useCorePlugins";

const load = vi.hoisted(() => vi.fn());
vi.mock("@/lib/plugins/corePlugins", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/plugins/corePlugins")>()),
  CORE_PLUGINS: [{ id: "glyph.core.d2", settingsKey: "d2", load }],
}));

const d2Module: PluginModule = {
  activate(ctx) {
    ctx.commands.register({ id: "d2.cmd", title: "D2", run: () => {} });
  },
};

function settingsValue(d2: boolean, loaded = true): SettingsContextValue {
  return {
    settings: { ...DEFAULT_SETTINGS, corePlugins: { ...DEFAULT_SETTINGS.corePlugins, d2 } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded,
  };
}

function renderCore(initial: SettingsContextValue) {
  const host = createPluginHost(vi.fn());
  let value = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
  );
  const pushToast = vi.fn();
  const view = renderHook(() => useCorePlugins(host, pushToast), { wrapper });
  const setSettings = (next: SettingsContextValue) => {
    value = next;
    view.rerender();
  };
  const commandIds = () => host.commands.list().map((c) => c.id);
  return { ...view, host, setSettings, commandIds, pushToast };
}

beforeEach(() => {
  load.mockReset();
  load.mockResolvedValue({ default: d2Module });
});

describe("useCorePlugins", () => {
  it("waits for settings to load before touching any core plugin", async () => {
    const { result, setSettings, commandIds } = renderCore(settingsValue(true, false));
    await act(() => Promise.resolve());
    expect(load).not.toHaveBeenCalled();
    expect(result.current.ready).toBe(false);

    setSettings(settingsValue(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(commandIds()).toEqual(["d2.cmd"]);
  });

  it("takes down a core plugin whose import lands after unmount", async () => {
    // Closing the window mid-startup: the 8 MB chunk resolves into a host
    // nobody holds any more, and its file types would stay registered.
    let landImport = (_module: { default: PluginModule }) => {};
    load.mockReturnValue(
      new Promise<{ default: PluginModule }>((resolve) => {
        landImport = resolve;
      }),
    );
    const { host, unmount, commandIds } = renderCore(settingsValue(true));
    await act(() => Promise.resolve());
    expect(load).toHaveBeenCalled();

    unmount();
    await act(async () => {
      landImport({ default: d2Module });
      await Promise.resolve();
    });
    expect(host.listLoaded()).toEqual([]);
    expect(commandIds()).toEqual([]);
  });

  it("never imports a disabled core plugin", async () => {
    const { result, commandIds } = renderCore(settingsValue(false));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(commandIds()).toEqual([]);
  });

  it("follows the toggle at runtime without a restart", async () => {
    const { result, setSettings, commandIds, host } = renderCore(settingsValue(false));
    await waitFor(() => expect(result.current.ready).toBe(true));

    setSettings(settingsValue(true));
    await waitFor(() => expect(commandIds()).toEqual(["d2.cmd"]));
    expect(host.listLoaded().map((p) => p.id)).toEqual(["glyph.core.d2"]);

    setSettings(settingsValue(false));
    await waitFor(() => expect(commandIds()).toEqual([]));
    expect(host.listLoaded()).toEqual([]);
  });

  it("does not re-import an already loaded core plugin on an unrelated settings change", async () => {
    const { setSettings, commandIds } = renderCore(settingsValue(true));
    await waitFor(() => expect(commandIds()).toEqual(["d2.cmd"]));

    setSettings({ ...settingsValue(true) });
    await act(() => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps a plugin switched off when the toggle flips back before its import resolves", async () => {
    let resolveImport: (module: { default: PluginModule }) => void = () => {};
    load.mockImplementationOnce(() => new Promise((resolve) => (resolveImport = resolve)));
    const { setSettings, commandIds, host } = renderCore(settingsValue(true));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    setSettings(settingsValue(false));
    await act(async () => resolveImport({ default: d2Module }));

    expect(commandIds()).toEqual([]);
    expect(host.listLoaded()).toEqual([]);
  });

  it("reports a non-Error load failure by its text", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValueOnce("offline");
    const { result, pushToast } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(pushToast).toHaveBeenCalledWith("Plugin error: offline", "error");
  });

  it("reports a core plugin that fails to load and still settles", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValueOnce(new Error("chunk failed"));
    const { result, pushToast } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(pushToast).toHaveBeenCalledWith("Plugin error: chunk failed", "error");
  });

  it("lists a core plugin whose load failed until a retry loads it", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValueOnce(new Error("chunk failed"));
    const { result, setSettings, commandIds } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current.failed).toEqual(["glyph.core.d2"]));

    // Any settings change to the toggles re-runs the pass, which retries it.
    setSettings(settingsValue(true));
    await waitFor(() => expect(result.current.failed).toEqual([]));
    expect(commandIds()).toEqual(["d2.cmd"]);
  });

  it("lists a core plugin once when its retry fails too", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValue(new Error("chunk failed"));
    const { result, setSettings, pushToast } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current.failed).toEqual(["glyph.core.d2"]));

    setSettings(settingsValue(true));
    await waitFor(() => expect(pushToast).toHaveBeenCalledTimes(2));
    expect(result.current.failed).toEqual(["glyph.core.d2"]);
  });

  it("does not list a core plugin turned off while its load was failing", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    let failImport: (err: Error) => void = () => {};
    load.mockImplementationOnce(() => new Promise((_resolve, reject) => (failImport = reject)));
    const { result, setSettings, pushToast } = renderCore(settingsValue(true));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    setSettings(settingsValue(false));
    await act(async () => failImport(new Error("chunk failed")));

    expect(pushToast).toHaveBeenCalled();
    expect(result.current.failed).toEqual([]);
  });

  it("stops listing a failed core plugin once it is turned off", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValueOnce(new Error("chunk failed"));
    const { result, setSettings } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current.failed).toEqual(["glyph.core.d2"]));

    setSettings(settingsValue(false));
    await waitFor(() => expect(result.current.failed).toEqual([]));
  });
});
