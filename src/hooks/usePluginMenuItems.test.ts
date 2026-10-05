import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isMobilePlatform } from "@/lib/platform";
import { createRegistry } from "@/lib/plugins/registry";
import type { CommandEntry, ExporterEntry } from "@/lib/plugins/types";
import { subscribe } from "@/lib/tauriEvent";
import { expectConsole } from "@/test/consoleGuard";
import { usePluginMenuItems } from "./usePluginMenuItems";

const plugins = vi.hoisted(() => ({
  current: null as { exporters: unknown; commands: unknown } | null,
}));
vi.mock("@/contexts/PluginsContext", () => ({ usePluginsOptional: () => plugins.current }));
vi.mock("@/lib/platform", () => ({ isMobilePlatform: vi.fn(() => false) }));
vi.mock("@/lib/tauriEvent", () => ({ subscribe: vi.fn(() => () => {}) }));

function exporter(id: string, label: string, pluginId = "com.x.slides"): ExporterEntry {
  return { pluginId, id, label, extension: "html", build: async () => "" };
}

function viewCommand(pluginId: string, run = vi.fn()): CommandEntry {
  return { pluginId, id: "present", title: "Slide Show", menu: "view", run };
}

function setUp() {
  const exporters = createRegistry<ExporterEntry>();
  const commands = createRegistry<CommandEntry>();
  plugins.current = { exporters, commands };
  return { exporters, commands };
}

function pickMenuItem(menu: "export" | "view", key: string) {
  const [, handler] = vi.mocked(subscribe).mock.calls.at(-1) as [string, (e: unknown) => void];
  handler({ payload: { menu, key } });
}

describe("usePluginMenuItems", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset().mockResolvedValue(0);
    vi.mocked(subscribe).mockClear();
    vi.mocked(isMobilePlatform).mockReturnValue(false);
  });

  it("lists exporters and view commands in the native menu, keyed by plugin and id", async () => {
    const { exporters, commands } = setUp();
    exporters.register(exporter("slides", "Slides"));
    commands.register(viewCommand("com.x.slides"));
    commands.register({
      pluginId: "com.x.slides",
      id: "palette-only",
      title: "Hidden",
      run: vi.fn(),
    });

    renderHook(() => usePluginMenuItems(vi.fn()));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [{ key: "com.x.slides/slides", label: "Slides…" }],
        view: [{ key: "com.x.slides/present", label: "Slide Show" }],
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
      dispose = exporters.register(exporter("slides", "Slides"));
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [{ key: "com.x.slides/slides", label: "Slides…" }],
        view: [],
      }),
    );

    act(() => dispose());
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", { export: [], view: [] }),
    );
  });

  it("lists nothing without a plugins provider", async () => {
    plugins.current = null;
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", { export: [], view: [] }),
    );
  });

  it("runs the picked exporter or command", () => {
    const { exporters, commands } = setUp();
    const run = vi.fn();
    const slides = exporter("slides", "Slides");
    exporters.register(slides);
    commands.register(viewCommand("com.x.slides", run));
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));

    pickMenuItem("export", "com.x.slides/slides");
    pickMenuItem("view", "com.x.slides/present");
    expect(runPluginExporter).toHaveBeenCalledWith(slides);
    expect(run).toHaveBeenCalled();
  });

  it("tells two plugins apart when their contributions share an id", async () => {
    const { exporters, commands } = setUp();
    const runA = vi.fn();
    const runB = vi.fn();
    commands.register(viewCommand("com.a", runA));
    commands.register(viewCommand("com.b", runB));
    const deckB = exporter("deck", "Deck B", "com.b");
    exporters.register(exporter("deck", "Deck A", "com.a"));
    exporters.register(deckB);
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [
          { key: "com.a/deck", label: "Deck A…" },
          { key: "com.b/deck", label: "Deck B…" },
        ],
        view: [
          { key: "com.a/present", label: "Slide Show" },
          { key: "com.b/present", label: "Slide Show" },
        ],
      }),
    );

    pickMenuItem("view", "com.b/present");
    expect(runB).toHaveBeenCalledOnce();
    expect(runA).not.toHaveBeenCalled();

    pickMenuItem("export", "com.b/deck");
    expect(runPluginExporter).toHaveBeenCalledExactlyOnceWith(deckB);
  });

  it("runs the contribution a stale menu names, never its neighbor", () => {
    // The native menu still lists [first, second]; `first` has since unloaded.
    const { exporters } = setUp();
    const second = exporter("second", "Second");
    const disposeFirst = exporters.register(exporter("first", "First"));
    exporters.register(second);
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));
    act(() => disposeFirst());

    pickMenuItem("export", "com.x.slides/first");
    expect(runPluginExporter).not.toHaveBeenCalled();

    pickMenuItem("export", "com.x.slides/second");
    expect(runPluginExporter).toHaveBeenCalledExactlyOnceWith(second);
  });

  it("ignores a key the registries do not have", () => {
    setUp();
    const runPluginExporter = vi.fn();
    renderHook(() => usePluginMenuItems(runPluginExporter));

    pickMenuItem("export", "gone");
    pickMenuItem("view", "gone");
    expect(runPluginExporter).not.toHaveBeenCalled();
  });

  it("skips the native menu on mobile", () => {
    setUp();
    vi.mocked(isMobilePlatform).mockReturnValue(true);
    renderHook(() => usePluginMenuItems(vi.fn()));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("says so when the backend refuses entries", async () => {
    setUp();
    expectConsole(/2 plugin menu entries were refused/);
    const errorSpy = vi.spyOn(console, "error");
    vi.mocked(invoke).mockResolvedValue(2);
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });

  it("logs a failed menu update", async () => {
    setUp();
    expectConsole(/Failed to list plugin menu items/);
    const errorSpy = vi.spyOn(console, "error");
    vi.mocked(invoke).mockRejectedValue("no menu");
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() => expect(errorSpy).toHaveBeenCalled());
  });
});
