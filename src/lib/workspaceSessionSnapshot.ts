import { isPathInside } from "@/lib/paths";
import { type PersistedTab, type Tab, tabPathOf } from "@/lib/tabs";
import { TAB_ZOOM_DEFAULT } from "@/lib/tabZoom";
import type {
  SidebarVisibility,
  WorkspaceSession,
  WorkspaceSessionTab,
} from "@/lib/workspaceSession";

// Pure builders for workspace session snapshots: from the live tab strip when
// capturing, and from the legacy global session list when migrating (#226).

interface BuildSessionInput {
  root: string;
  tabs: Tab[];
  activeTab: Tab | null;
  expanded: Iterable<string>;
  /** Live scroll memory for a tab id; undefined when never scrolled. */
  scrollOf: (tabId: string) => number | undefined;
  /** Live per-tab zoom multipliers, keyed by tab id. */
  zoomByTabId: Record<string, number>;
  sidebar: SidebarVisibility | null;
}

/** Snapshot the live state that belongs to the workspace at `root`. Loose
 *  files outside the root stay in the global session; virtual buffers have
 *  nothing on disk to restore and are skipped. */
export function buildWorkspaceSession({
  root,
  tabs,
  activeTab,
  expanded,
  scrollOf,
  zoomByTabId,
  sidebar,
}: BuildSessionInput): WorkspaceSession {
  const sessionTabs: WorkspaceSessionTab[] = [];
  const scroll: Record<string, number> = {};
  const zoom: Record<string, number> = {};
  for (const tab of tabs) {
    if (tab.kind === "graph") {
      sessionTabs.push({ kind: "graph", path: root });
      continue;
    }
    if (tab.file.virtual || !isPathInside(tab.file.path, root)) continue;
    sessionTabs.push({ kind: "file", path: tab.file.path });
    // The live memory wins even at 0 (scrolled back to top); the tab state is
    // the fallback for a tab whose memory was never touched.
    const scrollTop = scrollOf(tab.id) ?? tab.file.scrollTop;
    if (scrollTop > 0) scroll[tab.file.path] = scrollTop;
    const factor = zoomByTabId[tab.id];
    if (factor !== undefined && factor !== TAB_ZOOM_DEFAULT) zoom[tab.file.path] = factor;
  }
  return {
    tabs: sessionTabs,
    activeTabPath: clampActiveToRoot(activeTab ? tabPathOf(activeTab) : "", root),
    expanded: Array.from(expanded),
    scroll,
    zoom,
    ...(sidebar ? { sidebar } : {}),
    savedAt: Date.now(),
  };
}

/** The active path, or "" when it is empty or falls outside the workspace. */
function clampActiveToRoot(activePath: string, root: string): string {
  return activePath !== "" && isPathInside(activePath, root) ? activePath : "";
}

/** Build the first snapshot for `root` from the legacy global session list,
 *  which mixed the workspace's tabs with loose files. Only entries inside the
 *  workspace migrate; scroll and zoom were never persisted globally, so they
 *  start empty. An entry-less list yields an empty snapshot on purpose: the
 *  user had the workspace open with no tabs (empty is not absent). */
export function buildSessionFromLegacy(
  root: string,
  persistedTabs: PersistedTab[],
  activeTabPath: string,
): WorkspaceSession {
  const tabs: WorkspaceSessionTab[] = [];
  const folderEntry = persistedTabs.find((tab) => tab.kind === "folder");
  // Legacy folder tabs carried their single open file inline.
  if (folderEntry?.filePath) {
    tabs.push({ kind: "file", path: folderEntry.filePath });
  }
  for (const persisted of persistedTabs) {
    if (persisted.kind === "file" && isPathInside(persisted.path, root)) {
      if (!tabs.some((tab) => tab.kind === "file" && tab.path === persisted.path)) {
        tabs.push({ kind: "file", path: persisted.path });
      }
    } else if (persisted.kind === "graph" && persisted.path === root) {
      tabs.push({ kind: "graph", path: root });
    }
  }
  return {
    tabs,
    activeTabPath: clampActiveToRoot(activeTabPath, root),
    expanded: folderEntry?.expanded ?? [],
    scroll: {},
    zoom: {},
    savedAt: Date.now(),
  };
}
