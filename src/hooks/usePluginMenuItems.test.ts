import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMobilePlatform } from "@/lib/platform";
import { createRegistry } from "@/lib/plugins/registry";
import type { CommandContribution, ExporterContribution } from "@/lib/plugins/types";
import { subscribe } from "@/lib/tauriEvent";
import { expectConsole } from "@/test/consoleGuard";
import { usePluginMenuItems } from "./usePluginMenuItems";

const registries = vi.hoisted(() => ({
  exporters: null as unknown,
  commands: null as unknown,
}));
vi.mock("@/contexts/PluginsContext", () => ({ usePluginsOptional: () => registries }));
vi.mock("@/lib/platform", () => ({ isMobilePlatform: vi.fn(() => false) }));
vi.mock("@/lib/tauriEvent", () => ({ subscribe: vi.fn(() => () => {}) }));

const exporter: ExporterContribution = {
  id: "slides",
  label: "Slides",
  extension: "html",
  build: async () => "",
};

function setUp() {
  const exporters = createRegistry<ExporterContribution>();
  const commands = createRegistry<CommandContribution>();
  registries.exporters = exporters;
  registries.commands = commands;
  return { exporters, commands };
}

function clickMenuItem(menu: "export" | "view", index: number) {
  const [, handler] = vi.mocked(subscribe).mock.calls.at(-1) as [string, (e: unknown) => void];
  handler({ payload: { menu, index } });
}

describe("usePluginMenuItems", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(undefined);
    vi.mocked(subscribe).mockClear();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  it("lists exporters and view commands in the native menu", async () => {
    const { exporters, commands } = setUp();
    exporters.register(exporter);
    commands.register({ id: "present", title: "Slide Show", menu: "view", run: vi.fn() });
    commands.register({ id: "palette-only", title: "Hidden", run: vi.fn() });

    renderHook(() => usePluginMenuItems(vi.fn()));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: ["Slides…"],
        view: ["Slide Show"],
      }),
    );
  });

  it("re-lists when a plugin registers or unloads", async () => {
    const { exporters } = setUp();
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", { export: [], view: [] }),
    );

    let dispose = () => {};
    act(() => {
      dispose = exporters.register(exporter);
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: ["Slides…"],
        view: [],
      }),
    );

    act(() => dispose());
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", { export: [], view: [] }),
    );
  });

  it("runs the picked exporter or command", () => {
    const { exporters, commands } = setUp();
    const run = vi.fn();
    exporters.register(exporter);
    commands.register({ id: "present", title: "Slide Show", menu: "view", run });
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));

    clickMenuItem("export", 0);
    clickMenuItem("view", 0);
    expect(runPluginExporter).toHaveBeenCalledWith(exporter);
    expect(run).toHaveBeenCalled();
  });

  it("ignores an index the registries no longer have", () => {
    setUp();
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));

    clickMenuItem("export", 3);
    clickMenuItem("view", 3);
    expect(runPluginExporter).not.toHaveBeenCalled();
  });

  it("skips the native menu on mobile", () => {
    setUp();
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    renderHook(() => usePluginMenuItems(vi.fn()));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("logs a refused menu update", async () => {
    setUp();
    expectConsole(/Failed to list plugin menu items/);
    const errorSpy = vi.spyOn(console, "error");
    vi.mocked(invoke).mockRejectedValue("too many");
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});
