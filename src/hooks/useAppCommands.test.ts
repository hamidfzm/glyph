import { renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { createRegistry } from "@/lib/plugins/registry";
import type {
  CommandContribution,
  FencedRendererContribution,
  MarkdownPlugin,
  StatusBarItemContribution,
} from "@/lib/plugins/types";
import { type AppActions, useAppCommands } from "./useAppCommands";

function makeActions(over: Partial<AppActions> = {}): AppActions {
  return {
    openFile: vi.fn(),
    openFolder: vi.fn(),
    openGraph: vi.fn(),
    closeTab: vi.fn(),
    toggleFilesSidebar: vi.fn(),
    toggleOutlineSidebar: vi.fn(),
    resetView: vi.fn(),
    openSettings: vi.fn(),
    openSyncSettings: vi.fn(),
    find: vi.fn(),
    toggleEdit: vi.fn(),
    print: vi.fn(),
    exportHtml: vi.fn(),
    exportDocx: vi.fn(),
    exportEpub: vi.fn(),
    exportPdf: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    aiAction: vi.fn(),
    readAloud: vi.fn(),
    documentation: vi.fn(),
    releaseNotes: vi.fn(),
    reportIssue: vi.fn(),
    openWorkspaceFile: vi.fn(),
    managePlugins: vi.fn(),
    ...over,
  };
}

describe("useAppCommands", () => {
  it("emits app-level commands even with no workspace or headings", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: [],
        tocEntries: [],
        actions,
      }),
    );
    const titles = result.current.map((c) => c.title);
    expect(titles).toContain("Open File…");
    expect(titles).toContain("Settings…");
    expect(result.current.every((c) => c.section === "Commands")).toBe(true);
  });

  it("emits one Files command per workspace file when a workspace is open", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: true,
        workspaceFiles: ["/workspace/a.md", "/workspace/sub/b.md"],
        tocEntries: [],
        actions,
      }),
    );
    const files = result.current.filter((c) => c.section === "Files");
    expect(files.map((f) => f.title)).toEqual(["a.md", "b.md"]);
    files[0].run();
    expect(actions.openWorkspaceFile).toHaveBeenCalledWith("/workspace/a.md");
  });

  it("omits Files commands when there's no workspace", () => {
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: ["/anywhere/note.md"],
        tocEntries: [],
        actions: makeActions(),
      }),
    );
    expect(result.current.some((c) => c.section === "Files")).toBe(false);
  });

  it("emits a Heading command per TOC entry", () => {
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: [],
        tocEntries: [
          { id: "intro", text: "Introduction", level: 1 },
          { id: "details", text: "Details", level: 2 },
        ],
        actions: makeActions(),
      }),
    );
    const headings = result.current.filter((c) => c.section === "Headings");
    expect(headings.map((h) => h.title)).toEqual(["Introduction", "Details"]);
    expect(headings.map((h) => h.subtitle)).toEqual(["H1", "H2"]);
  });

  it("includes 'Cloud Sync…'", () => {
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: [],
        tocEntries: [],
        actions: makeActions(),
      }),
    );
    expect(result.current.map((c) => c.title)).toContain("Cloud Sync…");
  });

  it("each app command's run invokes the matching action", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: [],
        tocEntries: [],
        actions,
      }),
    );
    const find = (title: string) => result.current.find((c) => c.title === title)!;
    find("Open File…").run();
    find("Open Folder…").run();
    find("Close Tab").run();
    find("Toggle Files Sidebar").run();
    find("Toggle Outline Sidebar").run();
    find("Reset View").run();
    find("Settings…").run();
    find("Find in Document").run();
    find("Toggle Edit Mode").run();
    find("Open Graph").run();
    find("Print…").run();
    find("Zoom In").run();
    find("Zoom Out").run();
    find("Reset Zoom").run();
    find("Read Aloud").run();
    expect(actions.openFile).toHaveBeenCalledOnce();
    expect(actions.openFolder).toHaveBeenCalledOnce();
    expect(actions.closeTab).toHaveBeenCalledOnce();
    expect(actions.toggleFilesSidebar).toHaveBeenCalledOnce();
    expect(actions.toggleOutlineSidebar).toHaveBeenCalledOnce();
    expect(actions.resetView).toHaveBeenCalledOnce();
    expect(actions.openSettings).toHaveBeenCalledOnce();
    expect(actions.find).toHaveBeenCalledOnce();
    expect(actions.toggleEdit).toHaveBeenCalledOnce();
    expect(actions.openGraph).toHaveBeenCalledOnce();
    expect(actions.print).toHaveBeenCalledOnce();
    expect(actions.zoomIn).toHaveBeenCalledOnce();
    expect(actions.zoomOut).toHaveBeenCalledOnce();
    expect(actions.zoomReset).toHaveBeenCalledOnce();
    expect(actions.readAloud).toHaveBeenCalledOnce();
  });

  it("heading command's run scrolls to the entry's id", () => {
    const target = document.createElement("h2");
    target.id = "intro-heading";
    document.body.appendChild(target);
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;

    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: false,
        workspaceFiles: [],
        tocEntries: [{ id: "intro-heading", text: "Intro", level: 2 }],
        actions: makeActions(),
      }),
    );
    const heading = result.current.find((c) => c.section === "Headings")!;
    heading.run();
    expect(scrollIntoView).toHaveBeenCalled();
    document.body.removeChild(target);
  });

  it("file titles fall back to the full path when there are no separators", () => {
    const { result } = renderHook(() =>
      useAppCommands({
        workspaceOpen: true,
        workspaceFiles: ["loose"],
        tocEntries: [],
        actions: makeActions(),
      }),
    );
    const file = result.current.find((c) => c.section === "Files")!;
    expect(file.title).toBe("loose");
  });

  it("surfaces commands contributed by loaded plugins", () => {
    const commands = createRegistry<CommandContribution>();
    const run = vi.fn();
    commands.register({ id: "demo.greet", title: "Greet", run });
    const value: PluginsContextValue = {
      commands,
      statusBarItems: createRegistry<StatusBarItemContribution>(),
      remarkPlugins: createRegistry<MarkdownPlugin>(),
      rehypePlugins: createRegistry<MarkdownPlugin>(),
      fencedRenderers: createRegistry<FencedRendererContribution>(),
      installed: [],
      disabled: [],
      loaded: [],
      registry: [],
      updates: [],
      installFromFolder: vi.fn(async () => {}),
      installFromRegistry: vi.fn(async () => {}),
      setEnabled: vi.fn(async () => {}),
      uninstall: vi.fn(async () => {}),
    };
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(PluginsContext.Provider, { value }, children);

    const { result } = renderHook(
      () =>
        useAppCommands({
          workspaceOpen: false,
          workspaceFiles: [],
          tocEntries: [],
          actions: makeActions(),
        }),
      { wrapper },
    );

    const greet = result.current.find((c) => c.id === "plugin:demo.greet")!;
    expect(greet.title).toBe("Greet");
    greet.run();
    expect(run).toHaveBeenCalledOnce();
  });

  it("includes a Manage Plugins command", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({ workspaceOpen: false, workspaceFiles: [], tocEntries: [], actions }),
    );
    const manage = result.current.find((c) => c.id === "cmd:managePlugins")!;
    expect(manage).toBeTruthy();
    manage.run();
    expect(actions.managePlugins).toHaveBeenCalledOnce();
  });
});
