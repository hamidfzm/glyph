import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/lib/vault";
import { installed } from "@/test/fixtures/pluginHost";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { type PluginAppState, setPluginAppState } from "./appState";
import { DisposerBag } from "./disposer";
import { setPluginFileOpener } from "./navigationApi";
import { overlays } from "./overlays";
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
    workspaceSettingsPanels: createRegistry(),
    styles: createRegistry(),
    exporters: createRegistry(),
    siteThemes: createRegistry(),
  };
}

function context(
  bag: DisposerBag,
  into: ContextRegistries = registries(),
  root: string | null = "/ws",
) {
  return buildPluginContext({
    registries: into,
    bag,
    plugin: installed({ permissions: ["workspace:read"] }),
    settings: {},
    notify: vi.fn(),
    registerTranslations: vi.fn(),
    getWorkspaceRoot: () => root,
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

describe("buildPluginContext workspace settings", () => {
  it("lists a Workspace Settings tab under its plugin until the plugin unloads", () => {
    const into = registries();
    const bag = new DisposerBag();
    const ctx = context(bag, into);

    ctx.ui.addWorkspaceSettingsPanel({ id: "notes", title: "Daily Notes", mount: () => {} });
    expect(into.workspaceSettingsPanels.list()).toEqual([
      expect.objectContaining({ id: "notes", title: "Daily Notes", pluginId: "com.x.demo" }),
    ]);

    bag.dispose();
    expect(into.workspaceSettingsPanels.list()).toEqual([]);
  });

  it("removes a Workspace Settings tab when its disposer runs", () => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);

    const remove = ctx.ui.addWorkspaceSettingsPanel({ id: "notes", title: "N", mount: () => {} });
    remove();

    expect(into.workspaceSettingsPanels.list()).toEqual([]);
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

  // The divider computes with these; NaN or a negative height breaks the block.
  it.each([
    ["a NaN minimum", { min: Number.NaN }],
    ["a negative minimum", { min: -1 }],
    ["an infinite minimum", { min: Number.POSITIVE_INFINITY }],
    ["a minimum that is not a number", { min: "80" }],
    ["a NaN natural maximum", { min: 80, naturalMax: Number.NaN }],
    ["a negative natural maximum", { min: 80, naturalMax: -160 }],
  ])("refuses a sidebar panel whose frame has %s", (_case, frame) => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);
    const panel = { id: "links", title: "Links", location: "files", mount: () => {}, frame };
    expect(() => ctx.ui.addSidebarPanel(panel as never)).toThrow(/frame/);
    expect(into.sidebarPanels.list()).toEqual([]);
  });

  it("accepts a sidebar panel with a usable frame, or none", () => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);
    const panel = { id: "links", title: "Links", mount: () => {} };
    ctx.ui.addSidebarPanel({ ...panel, location: "files", frame: { min: 0, naturalMax: 160 } });
    ctx.ui.addSidebarPanel({ ...panel, id: "plain" });
    expect(into.sidebarPanels.list().map((entry) => entry.id)).toEqual(["links", "plain"]);
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

  // The host opens whatever a filter lists, so the list is held to the same
  // workspace as navigation.openFile.
  it.each([
    ["an absolute path outside the workspace", "/home/me/.ssh/config"],
    ["a sibling folder sharing the prefix", "/ws-other/a.md"],
    ["a relative path climbing out", "../outside.md"],
    ["an absolute path climbing out", "/ws/../etc/passwd"],
    ["the workspace root itself", "/ws"],
  ])("refuses a file tree filter listing %s", (_case, outsider) => {
    const into = registries();
    const ctx = context(new DisposerBag(), into);
    const filter = { label: "x", paths: ["/ws/a.md", outsider], onClear: vi.fn() };
    expect(() => ctx.ui.filterFileTree(filter)).toThrow(/outside the workspace/);
    expect(into.fileTreeFilters.list()).toEqual([]);
  });

  it("refuses a file tree filter while no workspace is open", () => {
    const into = registries();
    const ctx = context(new DisposerBag(), into, null);
    const filter = { label: "x", paths: ["a.md"], onClear: vi.fn() };
    expect(() => ctx.ui.filterFileTree(filter)).toThrow(/no workspace/);
    expect(into.fileTreeFilters.list()).toEqual([]);
  });

  it("lists a filter's files by the one path the tabs know each by", () => {
    const into = registries();
    context(new DisposerBag(), into).ui.filterFileTree({
      label: "x",
      paths: ["notes/a.md", "/ws//notes/./b.md"],
      onClear: vi.fn(),
    });
    expect(into.fileTreeFilters.list()[0].paths).toEqual(["/ws/notes/a.md", "/ws/notes/b.md"]);
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

describe("buildPluginContext overlays", () => {
  const overlay = { id: "show", label: "Slide show", mount: () => {} };

  afterEach(() => {
    for (const open of overlays.list()) open.close();
  });

  it("opens one overlay at a time and leaves the bag once closed", () => {
    const bag = new DisposerBag();
    const ctx = context(bag);

    ctx.ui.openOverlay(overlay);
    const close = ctx.ui.openOverlay({ ...overlay, id: "second" });
    expect(overlays.list().map((open) => open.id)).toEqual(["second"]);
    expect(bag.size).toBe(1);

    close();
    expect(overlays.list()).toEqual([]);
    expect(bag.size).toBe(0);
  });

  it("closes from the host's handle the same way", () => {
    const bag = new DisposerBag();
    context(bag).ui.openOverlay(overlay);

    overlays.list()[0].close();
    expect(overlays.list()).toEqual([]);
    expect(bag.size).toBe(0);
  });

  it("closes an open overlay when the plugin unloads", () => {
    const bag = new DisposerBag();
    context(bag).ui.openOverlay(overlay);

    bag.dispose();
    expect(overlays.list()).toEqual([]);
  });
});

describe("buildPluginContext documents", () => {
  it("serves the viewer's rendered document", async () => {
    mountDocumentBody("<p>Hi</p>");
    const html = await context(new DisposerBag()).documents.getRenderedHtml();
    document.body.innerHTML = "";

    expect(html).toBe("<p>Hi</p>");
  });
});
