import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SettingsContext, type SettingsContextValue } from "@/contexts/SettingsContext";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { isMobilePlatform } from "@/lib/platform";
import { createRegistry } from "@/lib/plugins/registry";
import type { CommandEntry, ExporterEntry } from "@/lib/plugins/types";
import { DEFAULT_SETTINGS } from "@/lib/settings";
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

function fileCommand(run = vi.fn(), over: Partial<CommandEntry> = {}): CommandEntry {
  return {
    pluginId: "com.x.notes",
    id: "today",
    title: "Open Today's Note",
    menu: "file",
    shortcut: "CmdOrCtrl+Shift+T",
    when: "workspace",
    run,
    ...over,
  };
}

/** The user's rebindings and the open workspace, which the hook reads from context. */
function withContexts(options: { overrides?: Record<string, string>; workspaceRoot?: string }) {
  const settings: SettingsContextValue = {
    settings: { ...DEFAULT_SETTINGS, keybindings: { overrides: options.overrides ?? {} } },
    updateSettings: vi.fn(),
    resetSettings: vi.fn(),
    flushSettings: async () => true,
    loaded: true,
  };
  const tabs = {
    workspace: options.workspaceRoot ? { root: options.workspaceRoot } : null,
  } as unknown as TabsContextValue;
  return ({ children }: { children: ReactNode }) =>
    createElement(
      SettingsContext.Provider,
      { value: settings },
      createElement(TabsContext.Provider, { value: tabs }, children),
    );
}

function setUp() {
  const exporters = createRegistry<ExporterEntry>();
  const commands = createRegistry<CommandEntry>();
  plugins.current = { exporters, commands };
  return { exporters, commands };
}

/** A command as the native menu is told about it. */
function menuEntry(key: string, label: string, over: Record<string, unknown> = {}) {
  return { key, label, accelerator: null, requiresWorkspace: false, ...over };
}

function pickMenuItem(menu: "export" | "file" | "view", key: string) {
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
        view: [menuEntry("com.x.slides/present", "Slide Show")],
        file: [],
      }),
    );
  });

  it("re-lists when a plugin registers or unloads", async () => {
    const { exporters } = setUp();
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [],
        view: [],
        file: [],
      }),
    );

    let dispose = () => {};
    act(() => {
      dispose = exporters.register(exporter("slides", "Slides"));
    });
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [{ key: "com.x.slides/slides", label: "Slides…" }],
        view: [],
        file: [],
      }),
    );

    act(() => dispose());
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [],
        view: [],
        file: [],
      }),
    );
  });

  it("lists nothing without a plugins provider", async () => {
    plugins.current = null;
    renderHook(() => usePluginMenuItems(vi.fn()));
    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [],
        view: [],
        file: [],
      }),
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
        view: [menuEntry("com.a/present", "Slide Show"), menuEntry("com.b/present", "Slide Show")],
        file: [],
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

  it("lists a file command with its shortcut and its workspace condition", async () => {
    const { commands } = setUp();
    commands.register(fileCommand());

    renderHook(() => usePluginMenuItems(vi.fn()));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith("set_plugin_menu_items", {
        export: [],
        view: [],
        file: [
          menuEntry("com.x.notes/today", "Open Today's Note", {
            accelerator: "CmdOrCtrl+Shift+T",
            requiresWorkspace: true,
          }),
        ],
      }),
    );
  });

  it("lists the shortcut the user rebound the command to", async () => {
    const { commands } = setUp();
    commands.register(fileCommand());
    const wrapper = withContexts({ overrides: { "plugin:com.x.notes/today": "CmdOrCtrl+Alt+D" } });

    renderHook(() => usePluginMenuItems(vi.fn()), { wrapper });

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "set_plugin_menu_items",
        expect.objectContaining({
          file: [expect.objectContaining({ accelerator: "CmdOrCtrl+Alt+D" })],
        }),
      ),
    );
  });

  it("lists a command without a usable shortcut with no accelerator", async () => {
    const { commands } = setUp();
    commands.register(fileCommand(vi.fn(), { shortcut: "CmdOrCtrl+A+B" }));

    renderHook(() => usePluginMenuItems(vi.fn()));

    await waitFor(() =>
      expect(invoke).toHaveBeenLastCalledWith(
        "set_plugin_menu_items",
        expect.objectContaining({ file: [expect.objectContaining({ accelerator: null })] }),
      ),
    );
  });

  it("runs a picked file command while its condition holds", () => {
    const { commands } = setUp();
    const run = vi.fn();
    commands.register(fileCommand(run));
    renderHook(() => usePluginMenuItems(vi.fn()), {
      wrapper: withContexts({ workspaceRoot: "/ws" }),
    });

    pickMenuItem("file", "com.x.notes/today");

    expect(run).toHaveBeenCalledOnce();
  });

  // A shared app menu can still show the item another window enabled.
  it("ignores a picked workspace command while no workspace is open", () => {
    const { commands } = setUp();
    const run = vi.fn();
    commands.register(fileCommand(run));
    renderHook(() => usePluginMenuItems(vi.fn()));

    pickMenuItem("file", "com.x.notes/today");

    expect(run).not.toHaveBeenCalled();
  });

  it("does not run a file command for a view item with the same key", () => {
    const { commands } = setUp();
    const run = vi.fn();
    commands.register(fileCommand(run, { when: undefined }));
    renderHook(() => usePluginMenuItems(vi.fn()));

    pickMenuItem("view", "com.x.notes/today");

    expect(run).not.toHaveBeenCalled();
  });
});
