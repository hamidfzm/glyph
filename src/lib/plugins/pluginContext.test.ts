import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { installed } from "@/test/fixtures/pluginHost";
import { type PluginAppState, setPluginAppState } from "./appState";
import { DisposerBag } from "./disposer";
import { setPluginFileOpener } from "./navigationApi";
import { buildPluginContext, type ContextRegistries } from "./pluginContext";
import { createRegistry } from "./registry";

const IDLE: PluginAppState = {
  workspaceRoot: null,
  activeDocument: null,
  snapshot: EMPTY_SNAPSHOT,
};

function registries(): ContextRegistries {
  return {
    commands: createRegistry(),
    statusBarItems: createRegistry(),
    remarkPlugins: createRegistry(),
    rehypePlugins: createRegistry(),
    fencedRenderers: createRegistry(),
    sidebarPanels: createRegistry(),
    fileTreeFilters: createRegistry(),
    settingsPanels: createRegistry(),
    styles: createRegistry(),
    exporters: createRegistry(),
    siteThemes: createRegistry(),
  };
}

function context(bag: DisposerBag, into: ContextRegistries = registries()) {
  return buildPluginContext({
    registries: into,
    bag,
    plugin: installed({ permissions: ["workspace:read"] }),
    settings: {},
    notify: vi.fn(),
    registerTranslations: vi.fn(),
    getWorkspaceRoot: () => "/ws",
    settingsBackend: { load: async () => ({}), save: vi.fn() },
  });
}

beforeEach(() => {
  setPluginAppState(IDLE);
  setPluginFileOpener(null);
});

describe("buildPluginContext i18n", () => {
  it("drops an early-disposed language listener from the plugin's bag", () => {
    // Renderers subscribe on every mount; a leftover entry per mount would pin
    // each detached render until the plugin unloads.
    const bag = new DisposerBag();
    const ctx = context(bag);
    for (let i = 0; i < 5; i++) ctx.i18n.onLanguageChange(() => {})();
    expect(bag.size).toBe(0);

    ctx.i18n.onLanguageChange(() => {});
    expect(bag.size).toBe(1);
  });
});

describe("buildPluginContext sidebar", () => {
  it("stamps a sidebar panel with the plugin that added it", () => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);
    ctx.ui.addSidebarPanel({ id: "links", title: "Links", location: "files", mount: () => {} });
    expect(into.sidebarPanels.list()).toEqual([
      expect.objectContaining({ id: "links", location: "files", pluginId: "com.x.demo" }),
    ]);
  });

  it("removes a file tree filter when disposed, and any left at unload", () => {
    const into = registries();
    const bag = new DisposerBag();
    const ctx = context(bag, into);
    const filter = { label: "#work (1)", paths: ["/ws/a.md"], onClear: vi.fn() };

    ctx.ui.filterFileTree(filter)();
    expect(into.fileTreeFilters.list()).toEqual([]);
    expect(bag.size).toBe(0);

    ctx.ui.filterFileTree(filter);
    expect(into.fileTreeFilters.list()).toEqual([filter]);
    bag.dispose();
    expect(into.fileTreeFilters.list()).toEqual([]);
  });

  // The Files panel renders a filter as given; a malformed one from an
  // untyped plugin would take the panel down with it.
  it.each([
    ["no paths", { label: "x", onClear: () => {} }],
    ["paths that are not strings", { label: "x", paths: [1, 2], onClear: () => {} }],
    ["no label", { paths: [], onClear: () => {} }],
    ["no onClear", { label: "x", paths: [] }],
    ["nothing at all", undefined],
  ])("refuses a file tree filter with %s", (_case, filter) => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);
    expect(() => ctx.ui.filterFileTree(filter as never)).toThrow(/file tree filter/);
    expect(into.fileTreeFilters.list()).toEqual([]);
  });

  it("keeps its own copy of a filter's paths", () => {
    const into = registries();
    const paths = ["/ws/a.md"];
    context(new DisposerBag(), into).ui.filterFileTree({ label: "x", paths, onClear: vi.fn() });
    paths.push("/ws/b.md");
    expect(into.fileTreeFilters.list()[0].paths).toEqual(["/ws/a.md"]);
  });
});

describe("buildPluginContext app state", () => {
  it("reports no active document until a tab shows one", () => {
    const ctx = context(new DisposerBag());
    expect(ctx.documents.getActive()).toBeNull();
  });

  it("hands over the active document with the window's selection", () => {
    const selection = vi
      .spyOn(window, "getSelection")
      .mockReturnValue({ toString: () => "picked" } as Selection);
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "# A" } });
    const ctx = context(new DisposerBag());

    expect(ctx.documents.getActive()).toEqual({
      path: "/ws/a.md",
      text: "# A",
      selection: "picked",
    });
    selection.mockRestore();
  });

  // Most callers want the path; serializing a long selection is not free.
  it("reads the selection only when it is asked for", () => {
    const selection = vi.spyOn(window, "getSelection");
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "# A" } });

    expect(context(new DisposerBag()).documents.getActive()?.path).toBe("/ws/a.md");
    expect(selection).not.toHaveBeenCalled();
    selection.mockRestore();
  });

  it("reports an empty selection when the window has none", () => {
    const selection = vi.spyOn(window, "getSelection").mockReturnValue(null);
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "" } });
    expect(context(new DisposerBag()).documents.getActive()?.selection).toBe("");
    selection.mockRestore();
  });

  it("tells a plugin when another document becomes active, not when its text changes", () => {
    const ctx = context(new DisposerBag());
    const listener = vi.fn();
    ctx.documents.onActiveChange(listener);

    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "a" } });
    setPluginAppState({ ...IDLE, activeDocument: { path: "/ws/a.md", text: "ab" } });
    expect(listener).toHaveBeenCalledOnce();

    setPluginAppState(IDLE);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("stops every app state listener when the plugin unloads", () => {
    const bag = new DisposerBag();
    const ctx = context(bag);
    const listener = vi.fn();
    ctx.documents.onActiveChange(listener);
    ctx.workspace.onChange(listener);
    ctx.vault.onChange(listener);

    bag.dispose();
    setPluginAppState({
      workspaceRoot: "/other",
      activeDocument: { path: "/other/a.md", text: "" },
      snapshot: { ...EMPTY_SNAPSHOT },
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("drops an early-disposed app state listener from the bag", () => {
    const bag = new DisposerBag();
    const ctx = context(bag);
    const listener = vi.fn();
    ctx.vault.onChange(listener)();
    ctx.workspace.onChange(listener)();
    expect(bag.size).toBe(0);

    setPluginAppState({ ...IDLE, workspaceRoot: "/other", snapshot: { ...EMPTY_SNAPSHOT } });
    expect(listener).not.toHaveBeenCalled();
  });

  it("opens a workspace file through the app", () => {
    const open = vi.fn();
    setPluginFileOpener(open);
    context(new DisposerBag()).navigation.openFile("/ws/a.md", { line: 3 });
    expect(open).toHaveBeenCalledExactlyOnceWith("/ws/a.md", 3);
  });
});
