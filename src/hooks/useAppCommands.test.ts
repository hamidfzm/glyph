import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FolderTab } from "@/hooks/useTabs";
import { type AppActions, useAppCommands } from "./useAppCommands";

function makeFolderTab(): FolderTab {
  return {
    id: "folder-1",
    kind: "folder",
    root: "/workspace",
    expanded: new Set(),
    nodes: new Map(),
    file: null,
  };
}

function makeActions(over: Partial<AppActions> = {}): AppActions {
  return {
    openFile: vi.fn(),
    openFolder: vi.fn(),
    closeTab: vi.fn(),
    toggleFilesSidebar: vi.fn(),
    toggleOutlineSidebar: vi.fn(),
    resetView: vi.fn(),
    openSettings: vi.fn(),
    find: vi.fn(),
    toggleEdit: vi.fn(),
    print: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    zoomReset: vi.fn(),
    aiAction: vi.fn(),
    readAloud: vi.fn(),
    openFileInFolderTab: vi.fn(),
    ...over,
  };
}

describe("useAppCommands", () => {
  it("emits app-level commands even with no workspace or headings", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        activeFolderTab: null,
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

  it("emits one Files command per workspace file when a folder tab is active", () => {
    const folder = makeFolderTab();
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        activeFolderTab: folder,
        workspaceFiles: ["/workspace/a.md", "/workspace/sub/b.md"],
        tocEntries: [],
        actions,
      }),
    );
    const files = result.current.filter((c) => c.section === "Files");
    expect(files.map((f) => f.title)).toEqual(["a.md", "b.md"]);
    files[0].run();
    expect(actions.openFileInFolderTab).toHaveBeenCalledWith("folder-1", "/workspace/a.md");
  });

  it("omits Files commands when there's no folder tab", () => {
    const { result } = renderHook(() =>
      useAppCommands({
        activeFolderTab: null,
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
        activeFolderTab: null,
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

  it("each app command's run invokes the matching action", () => {
    const actions = makeActions();
    const { result } = renderHook(() =>
      useAppCommands({
        activeFolderTab: null,
        workspaceFiles: [],
        tocEntries: [],
        actions,
      }),
    );
    const find = (title: string) => result.current.find((c) => c.title === title)!;
    find("Open File…").run();
    find("Toggle Files Sidebar").run();
    find("Reset Zoom").run();
    expect(actions.openFile).toHaveBeenCalledOnce();
    expect(actions.toggleFilesSidebar).toHaveBeenCalledOnce();
    expect(actions.zoomReset).toHaveBeenCalledOnce();
  });
});
