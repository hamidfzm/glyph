import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FileTab, GraphTab, Tab } from "@/lib/tabs";
import type { ContextMenuActionItem } from "./contextMenuItems";
import { buildTabMenuItems } from "./tabMenuItems";

// The builder only reads ids, kinds, paths, and the virtual flag, so the tab
// fixtures stay thin.
const fileTab = (i: number, virtual = false): FileTab =>
  ({
    id: `tab-${i}`,
    kind: "file",
    file: { path: virtual ? `Untitled-${i}` : `/p/file${i}.md`, virtual },
  }) as FileTab;

const graphTab = (i: number): GraphTab =>
  ({ id: `tab-${i}`, kind: "graph", root: "/p", file: null }) as GraphTab;

const tabs = (count: number): Tab[] => Array.from({ length: count }, (_, i) => fileTab(i));

// The real `t` is not needed: the builder just labels items, so echoing the key
// keeps the assertions readable.
const t = ((key: string) => key) as unknown as Parameters<typeof buildTabMenuItems>[3];

function labels(items: ReturnType<typeof buildTabMenuItems>): string[] {
  return items.filter((item) => item.kind !== "separator").map((item) => item.label);
}

function select(items: ReturnType<typeof buildTabMenuItems>, label: string): void {
  const item = items.find((i) => i.kind === "action" && i.label === label) as ContextMenuActionItem;
  item.onSelect();
}

describe("buildTabMenuItems", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(revealItemInDir).mockResolvedValue(undefined);
  });

  it("returns nothing when the target tab is gone", () => {
    expect(buildTabMenuItems(tabs(2), "missing", vi.fn(), t)).toEqual([]);
  });

  it("omits Close to the Left on the first tab", () => {
    const items = labels(buildTabMenuItems(tabs(3), "tab-0", vi.fn(), t));
    expect(items).toContain("tabBar.contextMenu.closeToRight");
    expect(items).not.toContain("tabBar.contextMenu.closeToLeft");
  });

  it("omits Close to the Right on the last tab", () => {
    const items = labels(buildTabMenuItems(tabs(3), "tab-2", vi.fn(), t));
    expect(items).toContain("tabBar.contextMenu.closeToLeft");
    expect(items).not.toContain("tabBar.contextMenu.closeToRight");
  });

  it("offers only Close when a single tab is open", () => {
    const items = labels(buildTabMenuItems(tabs(1), "tab-0", vi.fn(), t));
    expect(items).toEqual([
      "tabBar.contextMenu.close",
      "fileTree.copyAbsolutePath",
      "fileTree.reveal",
    ]);
  });

  it("closes the target, the others, and each side with the right ids", () => {
    const closeTabs = vi.fn();
    const items = buildTabMenuItems(tabs(4), "tab-1", closeTabs, t);

    select(items, "tabBar.contextMenu.close");
    expect(closeTabs).toHaveBeenLastCalledWith(["tab-1"]);

    select(items, "tabBar.contextMenu.closeOthers");
    expect(closeTabs).toHaveBeenLastCalledWith(["tab-0", "tab-2", "tab-3"]);

    select(items, "tabBar.contextMenu.closeToRight");
    expect(closeTabs).toHaveBeenLastCalledWith(["tab-2", "tab-3"]);

    select(items, "tabBar.contextMenu.closeToLeft");
    expect(closeTabs).toHaveBeenLastCalledWith(["tab-0"]);

    select(items, "tabBar.contextMenu.closeAll");
    expect(closeTabs).toHaveBeenLastCalledWith(["tab-0", "tab-1", "tab-2", "tab-3"]);
  });

  it("copies the target tab's path", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    select(buildTabMenuItems(tabs(2), "tab-1", vi.fn(), t), "fileTree.copyAbsolutePath");
    expect(writeText).toHaveBeenCalledWith("/p/file1.md");
    vi.unstubAllGlobals();
  });

  it("reveals the target tab's file in the OS file manager", () => {
    select(buildTabMenuItems(tabs(1), "tab-0", vi.fn(), t), "fileTree.reveal");
    expect(revealItemInDir).toHaveBeenCalledWith("/p/file0.md");
  });

  it("tolerates a reveal the OS refuses", async () => {
    vi.mocked(revealItemInDir).mockRejectedValue(new Error("no such file"));
    select(buildTabMenuItems(tabs(1), "tab-0", vi.fn(), t), "fileTree.reveal");
    await Promise.resolve();
    expect(revealItemInDir).toHaveBeenCalled();
  });

  // A virtual buffer's path is its "Untitled-N" title, which is neither worth
  // copying nor revealable.
  it("hides the path items for an unsaved document", () => {
    const items = labels(buildTabMenuItems([fileTab(0, true)], "tab-0", vi.fn(), t));
    expect(items).toEqual(["tabBar.contextMenu.close"]);
  });

  it("hides the path items for a graph tab, which has no single file", () => {
    const items = labels(buildTabMenuItems([fileTab(0), graphTab(1)], "tab-1", vi.fn(), t));
    expect(items).not.toContain("fileTree.copyAbsolutePath");
    expect(items).not.toContain("fileTree.reveal");
    expect(items).toContain("tabBar.contextMenu.close");
  });
});
