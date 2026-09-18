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
    settings: { ...DEFAULT_SETTINGS, corePlugins: { d2 } },
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
    expect(result.current).toBe(false);

    setSettings(settingsValue(true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(commandIds()).toEqual(["d2.cmd"]);
  });

  it("never imports a disabled core plugin", async () => {
    const { result, commandIds } = renderCore(settingsValue(false));
    await waitFor(() => expect(result.current).toBe(true));
    expect(load).not.toHaveBeenCalled();
    expect(commandIds()).toEqual([]);
  });

  it("follows the toggle at runtime without a restart", async () => {
    const { result, setSettings, commandIds, host } = renderCore(settingsValue(false));
    await waitFor(() => expect(result.current).toBe(true));

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
    await waitFor(() => expect(result.current).toBe(true));
    expect(pushToast).toHaveBeenCalledWith("Plugin error: offline", "error");
  });

  it("reports a core plugin that fails to load and still settles", async () => {
    expectConsole(/Failed to load core plugin glyph\.core\.d2/);
    load.mockRejectedValueOnce(new Error("chunk failed"));
    const { result, pushToast } = renderCore(settingsValue(true));
    await waitFor(() => expect(result.current).toBe(true));
    expect(pushToast).toHaveBeenCalledWith("Plugin error: chunk failed", "error");
  });
});
