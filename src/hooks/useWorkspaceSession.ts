import { type RefObject, useCallback, useEffect } from "react";
import { isCliExportProcess } from "@/lib/cliExport";
import { sessionSidebarBridge, sessionZoomBridge } from "@/lib/sessionUiBridge";
import type { Tab, TabsState, Workspace } from "@/lib/tabs";
import {
  flushWorkspaceSessions,
  isSessionRestoring,
  saveWorkspaceSession,
  type WorkspaceSession,
} from "@/lib/workspaceSession";
import { buildWorkspaceSession } from "@/lib/workspaceSessionSnapshot";

export interface WorkspaceSessionApi {
  /** Snapshot the current workspace's live state into the session store. */
  captureSession: () => void;
  /** Reopen a snapshot's tabs with their scroll, zoom, active tab, and
   *  sidebar visibility. Abandons quietly if the workspace changes mid-way. */
  restoreSession: (root: string, session: WorkspaceSession) => Promise<void>;
}

interface UseWorkspaceSessionOptions {
  stateRef: RefObject<TabsState>;
  workspaceRef: RefObject<Workspace | null>;
  tabs: Tab[];
  activeTab: Tab | null;
  workspace: Workspace | null;
  initializing: boolean;
  getScrollPosition: (id: string) => number | undefined;
  openFile: (
    path: string,
    open?: { initialScrollTop?: number; stillWanted?: () => boolean; silent?: boolean },
  ) => Promise<string | undefined>;
  openGraph: (root?: string) => void;
  activateTabByPath: (path: string) => void;
}

/**
 * Per-workspace session persistence (#226): keeps the open workspace's
 * snapshot current as tabs change, and rebuilds a workspace from its snapshot
 * when it is reopened. Both the primary and secondary windows persist here;
 * only the global session key in settings stays primary-only.
 */
export function useWorkspaceSession({
  stateRef,
  workspaceRef,
  tabs,
  activeTab,
  workspace,
  initializing,
  getScrollPosition,
  openFile,
  openGraph,
  activateTabByPath,
}: UseWorkspaceSessionOptions): WorkspaceSessionApi & {
  flushSessionForClose: () => Promise<void>;
} {
  const snapshotNow = useCallback(
    (ws: Workspace, liveTabs: Tab[], liveActiveTab: Tab | null) => {
      saveWorkspaceSession(
        ws.root,
        buildWorkspaceSession({
          root: ws.root,
          tabs: liveTabs,
          activeTab: liveActiveTab,
          expanded: ws.expanded,
          scrollOf: getScrollPosition,
          zoomByTabId: sessionZoomBridge()?.zoomByTabId() ?? {},
          sidebar: sessionSidebarBridge()?.visibility() ?? null,
        }),
      );
    },
    [getScrollPosition],
  );

  const captureSession = useCallback(() => {
    const ws = workspaceRef.current;
    if (!ws || isCliExportProcess()) return;
    const { tabs: liveTabs, activeTabId } = stateRef.current;
    snapshotNow(ws, liveTabs, liveTabs.find((tab) => tab.id === activeTabId) ?? null);
  }, [snapshotNow, stateRef, workspaceRef]);

  const restoreSession = useCallback(
    async (root: string, session: WorkspaceSession) => {
      const isCurrent = () => workspaceRef.current?.root === root;
      const idByPath = new Map<string, string>();
      for (const entry of session.tabs) {
        if (!isCurrent()) return;
        if (entry.kind === "graph") {
          openGraph(root);
          continue;
        }
        const id = await openFile(entry.path, {
          initialScrollTop: session.scroll[entry.path],
          stillWanted: isCurrent,
          silent: true,
        });
        if (id !== undefined) idByPath.set(entry.path, id);
      }
      if (!isCurrent()) return;
      const zoomByTabId: Record<string, number> = {};
      for (const [path, factor] of Object.entries(session.zoom)) {
        const id = idByPath.get(path);
        if (id) zoomByTabId[id] = factor;
      }
      if (Object.keys(zoomByTabId).length > 0) {
        sessionZoomBridge()?.seedZoom(zoomByTabId);
      }
      // A snapshot without sidebar state resyncs the panels to the global
      // setting, so the previous workspace's visibility never leaks in.
      sessionSidebarBridge()?.applyVisibility(session.sidebar ?? null);
      if (session.activeTabPath) activateTabByPath(session.activeTabPath);
    },
    [activateTabByPath, openFile, openGraph, workspaceRef],
  );

  // Keep the snapshot current as the strip changes (open/close/reorder/
  // activate, and expanded-folder toggles via the workspace object). Scroll
  // and zoom are read at capture time; the close flush picks up the final
  // deltas. Suppressed while a restore or teardown churns the strip so a
  // half-restored state never overwrites a workspace's snapshot.
  useEffect(() => {
    if (initializing || !workspace || isSessionRestoring() || isCliExportProcess()) return;
    snapshotNow(workspace, tabs, activeTab);
  }, [tabs, activeTab, workspace, initializing, snapshotNow]);

  // Capture the final scroll positions and write every queued snapshot before
  // the window closes (INV-4: owners flush before they die). A close that
  // lands mid-restore skips the capture: the half-restored strip must not
  // overwrite the stored snapshot it is being rebuilt from (INV-3).
  const flushSessionForClose = useCallback(() => {
    if (!isSessionRestoring()) captureSession();
    return flushWorkspaceSessions();
  }, [captureSession]);

  return { captureSession, restoreSession, flushSessionForClose };
}
