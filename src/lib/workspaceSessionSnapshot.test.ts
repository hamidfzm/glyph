import { describe, expect, it } from "vitest";
import type { PersistedTab, Tab } from "@/lib/tabs";
import { buildSessionFromLegacy, buildWorkspaceSession } from "./workspaceSessionSnapshot";

function fileTab(id: string, path: string): Tab & { kind: "file" } {
  return {
    id,
    kind: "file",
    file: {
      path,
      content: "",
      metadata: null,
      scrollTop: 0,
      mode: "view",
      editContent: null,
      dirty: false,
      virtual: false,
      revision: 0,
    },
  };
}

function virtualTab(id: string, title: string): Tab {
  const tab = fileTab(id, title);
  tab.file.virtual = true;
  return tab;
}

const graphTab: Tab = { id: "g", kind: "graph", root: "/ws", file: null };

describe("buildWorkspaceSession", () => {
  const base = {
    root: "/ws",
    expanded: ["/ws/sub"],
    scrollOf: () => undefined,
    zoomByTabId: {},
    sidebar: null,
  };

  it("captures workspace tabs in strip order with a graph marker", () => {
    const tabs = [fileTab("a", "/ws/a.md"), graphTab, fileTab("b", "/ws/sub/b.md")];
    const session = buildWorkspaceSession({ ...base, tabs, activeTab: tabs[2] });

    expect(session.tabs).toEqual([
      { kind: "file", path: "/ws/a.md" },
      { kind: "graph", path: "/ws" },
      { kind: "file", path: "/ws/sub/b.md" },
    ]);
    expect(session.activeTabPath).toBe("/ws/sub/b.md");
    expect(session.expanded).toEqual(["/ws/sub"]);
    expect(session.savedAt).toBeGreaterThan(0);
  });

  it("skips loose files outside the root and virtual buffers", () => {
    const tabs = [
      fileTab("a", "/ws/a.md"),
      fileTab("x", "/elsewhere/x.md"),
      virtualTab("v", "Untitled-1"),
    ];
    const session = buildWorkspaceSession({ ...base, tabs, activeTab: null });

    expect(session.tabs).toEqual([{ kind: "file", path: "/ws/a.md" }]);
  });

  it("records scroll from the live memory, falling back to the tab state", () => {
    const tabs = [fileTab("a", "/ws/a.md"), fileTab("b", "/ws/b.md"), fileTab("c", "/ws/c.md")];
    tabs[1].file.scrollTop = 40;
    const session = buildWorkspaceSession({
      ...base,
      tabs,
      activeTab: null,
      scrollOf: (id) => (id === "a" ? 120 : undefined),
    });

    // a: live memory wins; b: state fallback; c: never scrolled, omitted.
    expect(session.scroll).toEqual({ "/ws/a.md": 120, "/ws/b.md": 40 });
  });

  it("a live scroll of 0 beats a stale tab-state position: scrolled-to-top persists", () => {
    const tabs = [fileTab("a", "/ws/a.md")];
    tabs[0].file.scrollTop = 800;
    const session = buildWorkspaceSession({
      ...base,
      tabs,
      activeTab: null,
      scrollOf: () => 0,
    });

    expect(session.scroll).toEqual({});
  });

  it("records only non-default zoom, keyed by path", () => {
    const tabs = [fileTab("a", "/ws/a.md"), fileTab("b", "/ws/b.md")];
    const session = buildWorkspaceSession({
      ...base,
      tabs,
      activeTab: null,
      zoomByTabId: { a: 1.5, b: 1 },
    });

    expect(session.zoom).toEqual({ "/ws/a.md": 1.5 });
  });

  it("drops an active tab that lives outside the workspace", () => {
    const loose = fileTab("x", "/elsewhere/x.md");
    const session = buildWorkspaceSession({
      ...base,
      tabs: [fileTab("a", "/ws/a.md"), loose],
      activeTab: loose,
    });

    expect(session.activeTabPath).toBe("");
  });

  it("keeps an active graph tab (its path is the root)", () => {
    const session = buildWorkspaceSession({ ...base, tabs: [graphTab], activeTab: graphTab });
    expect(session.activeTabPath).toBe("/ws");
  });

  it("carries sidebar visibility when provided, omits it without a bridge", () => {
    const withSidebar = buildWorkspaceSession({
      ...base,
      tabs: [],
      activeTab: null,
      sidebar: { filesSidebarVisible: false, outlineSidebarVisible: true },
    });
    expect(withSidebar.sidebar).toEqual({
      filesSidebarVisible: false,
      outlineSidebarVisible: true,
    });

    const withoutSidebar = buildWorkspaceSession({ ...base, tabs: [], activeTab: null });
    expect(withoutSidebar.sidebar).toBeUndefined();
  });
});

describe("buildSessionFromLegacy", () => {
  const legacy: PersistedTab[] = [
    { kind: "folder", path: "/ws", expanded: ["/ws/sub"] },
    { kind: "file", path: "/ws/a.md" },
    { kind: "file", path: "/elsewhere/x.md" },
    { kind: "graph", path: "/ws" },
  ];

  it("migrates only the entries inside the workspace, keeping order", () => {
    const session = buildSessionFromLegacy("/ws", legacy, "/ws/a.md");

    expect(session.tabs).toEqual([
      { kind: "file", path: "/ws/a.md" },
      { kind: "graph", path: "/ws" },
    ]);
    expect(session.expanded).toEqual(["/ws/sub"]);
    expect(session.activeTabPath).toBe("/ws/a.md");
    expect(session.scroll).toEqual({});
    expect(session.zoom).toEqual({});
  });

  it("opens the legacy folder-tab inline file first, without duplicating it", () => {
    const withInline: PersistedTab[] = [
      { kind: "folder", path: "/ws", filePath: "/ws/a.md" },
      { kind: "file", path: "/ws/a.md" },
      { kind: "file", path: "/ws/b.md" },
    ];
    const session = buildSessionFromLegacy("/ws", withInline, "");

    expect(session.tabs).toEqual([
      { kind: "file", path: "/ws/a.md" },
      { kind: "file", path: "/ws/b.md" },
    ]);
  });

  it("skips a graph entry whose root doesn't match the workspace", () => {
    const mismatched: PersistedTab[] = [
      { kind: "folder", path: "/ws" },
      { kind: "graph", path: "/other" },
    ];
    expect(buildSessionFromLegacy("/ws", mismatched, "").tabs).toEqual([]);
  });

  it("drops an active path outside the workspace", () => {
    const session = buildSessionFromLegacy("/ws", legacy, "/elsewhere/x.md");
    expect(session.activeTabPath).toBe("");
  });

  it("yields an empty snapshot for a folder-only session: the user had no tabs open", () => {
    const session = buildSessionFromLegacy("/ws", [{ kind: "folder", path: "/ws" }], "");
    expect(session.tabs).toEqual([]);
    expect(session.expanded).toEqual([]);
  });
});
