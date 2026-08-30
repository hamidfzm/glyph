// Tab-strip and workspace shapes plus the pure state transforms over them.
// Kept out of `useTabs` so both the hook and its consumers can import the
// types without pulling in the hook, and so the transforms stay testable.

import type { EditorMode } from "@/lib/settings";

export interface FileMetadata {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  modified: number;
}

export interface FileState {
  path: string;
  content: string | null;
  metadata: FileMetadata | null;
  scrollTop: number;
  mode: EditorMode;
  editContent: string | null;
  dirty: boolean;
  /** Unsaved buffer with no file on disk; `path` holds a display title until
   *  the first Save. Virtual tabs are never watched, indexed, or persisted. */
  virtual: boolean;
  /** Monotonic edit counter. Every edit bumps it; a save records the revision
   *  it wrote, and clears `dirty` only if the revision is still current. This
   *  stops an in-flight write from marking a newer edit clean. */
  revision: number;
}

export interface FileTab {
  id: string;
  kind: "file";
  file: FileState;
}

export interface GraphTab {
  id: string;
  kind: "graph";
  /** Workspace root this graph visualizes (always the window's workspace). */
  root: string;
  /** Graph tabs never display a document. Present so `activeFileOf` stays a
   *  plain field read across all tab kinds. */
  file: null;
}

export type Tab = FileTab | GraphTab;

/**
 * The window's folder workspace. One per window (VS Code model): the sidebar
 * tree, wikilink index, backlinks, and graph all hang off this, while the tab
 * strip holds plain document tabs — workspace notes and loose external files
 * alike. Opening another folder replaces it.
 */
export interface Workspace {
  root: string;
  expanded: Set<string>;
  nodes: Map<string, DirEntry[]>;
}

export interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PersistedTab {
  kind: "file" | "folder" | "graph";
  path: string; // workspace root for folder/graph entries, file path for file
  filePath?: string; // legacy: the single file once shown inside a folder tab
  expanded?: string[]; // legacy: expanded subdirs, now in the workspace snapshot
}

export function makeFileState(path: string, mode: EditorMode): FileState {
  return {
    path,
    content: null,
    metadata: null,
    scrollTop: 0,
    mode,
    editContent: null,
    dirty: false,
    virtual: false,
    revision: 0,
  };
}

export function activeFileOf(tab: Tab | null | undefined): FileState | null {
  if (!tab) return null;
  return tab.file;
}

export function tabPathOf(tab: Tab): string {
  return tab.kind === "file" ? tab.file.path : tab.root;
}

export function normalizePersistedTabs(value: PersistedTab[] | string[]): PersistedTab[] {
  if (value.length === 0) return [];
  // Legacy: array of file paths
  if (typeof value[0] === "string") {
    return (value as string[]).map((path) => ({ kind: "file" as const, path }));
  }
  return value as PersistedTab[];
}

/** Remove `ids` from the tab strip, moving the active tab to a neighbour when
 *  the current one is among the removed. */
export function removeTabs(prev: TabsState, ids: ReadonlySet<string>): TabsState {
  if (ids.size === 0) return prev;
  const activeIdx = prev.tabs.findIndex((t) => t.id === prev.activeTabId);
  const updated = prev.tabs.filter((t) => !ids.has(t.id));
  let newActiveId = prev.activeTabId;
  if (newActiveId !== null && ids.has(newActiveId)) {
    const fallback = updated[Math.min(Math.max(activeIdx, 0), updated.length - 1)] ?? null;
    newActiveId = fallback?.id ?? null;
  }
  return { tabs: updated, activeTabId: newActiveId };
}

/** Move tab `id` to `toIndex` (clamped to the strip); identity when it can't move. */
export function reorderTabs(prev: TabsState, id: string, toIndex: number): TabsState {
  const from = prev.tabs.findIndex((t) => t.id === id);
  if (from === -1) return prev;
  const to = Math.max(0, Math.min(toIndex, prev.tabs.length - 1));
  if (to === from) return prev;
  const tabs = [...prev.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return { ...prev, tabs };
}
