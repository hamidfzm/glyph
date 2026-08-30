import { invoke } from "@tauri-apps/api/core";
import { type Dispatch, type RefObject, type SetStateAction, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { OpenFileOptions } from "@/hooks/useOpenDocument";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { isMarkdownFile } from "@/lib/markdownExtensions";
import { isPathInside } from "@/lib/paths";
import { pickFolder, pickNewWorkspace } from "@/lib/pickers";
import { removeTabs, type TabsState, type Workspace } from "@/lib/tabs";
import { getWorkspaceLastFile, resolveWorkspace, type WorkspaceResolution } from "@/lib/workspace";

export interface OpenFolderOptions {
  expanded?: string[];
  silent?: boolean;
  autoLoad?: boolean;
}

interface UseWorkspaceLifecycleOptions {
  stateRef: RefObject<TabsState>;
  setState: Dispatch<SetStateAction<TabsState>>;
  workspaceRef: RefObject<Workspace | null>;
  openTree: (root: string, expanded?: string[]) => Promise<void>;
  clearTree: () => void;
  scanWorkspace: (root: string, isCurrent: () => boolean) => Promise<string[]>;
  clearIndexes: () => void;
  resetStatus: () => void;
  flushForClose: (ids?: Iterable<string>) => Promise<boolean>;
  openFile: (path: string, options?: OpenFileOptions) => Promise<boolean>;
  forgetScroll: (id: string) => void;
  forgetHistory: (id: string) => void;
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * Opening, replacing, and closing the window's single folder workspace. One
 * workspace per window (VS Code model), so adopting a folder tears the previous
 * one down: its dirty documents are flushed, its tabs closed, its indexes dropped.
 */
export function useWorkspaceLifecycle({
  stateRef,
  setState,
  workspaceRef,
  openTree,
  clearTree,
  scanWorkspace,
  clearIndexes,
  resetStatus,
  flushForClose,
  openFile,
  forgetScroll,
  forgetHistory,
  onWorkspaceNotice,
}: UseWorkspaceLifecycleOptions) {
  const { t } = useTranslation("workspace");
  const onWorkspaceNoticeRef = useRef(onWorkspaceNotice);
  onWorkspaceNoticeRef.current = onWorkspaceNotice;
  // Guards concurrent openFolder calls for the same root (StrictMode double
  // mount, rapid re-invocation) so the folder is only watched/loaded once.
  const folderOpenInFlight = useRef<string | null>(null);

  // Close every tab that belongs to the workspace at `root`: file tabs inside
  // it plus graph tabs (they render its index). Loose external files survive.
  const closeWorkspaceTabs = useCallback(
    (root: string) => {
      setState((prev) => {
        const removedIds = new Set<string>();
        for (const tab of prev.tabs) {
          if (tab.kind === "graph") {
            removedIds.add(tab.id);
          } else if (isPathInside(tab.file.path, root)) {
            invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
            removedIds.add(tab.id);
          }
        }
        for (const removedId of removedIds) {
          forgetScroll(removedId);
          forgetHistory(removedId);
        }
        return removeTabs(prev, removedIds);
      });
    },
    [forgetHistory, forgetScroll, setState],
  );

  /** Ids of the open file tabs that live inside `root`. */
  const tabIdsInside = useCallback(
    (root: string) =>
      stateRef.current.tabs
        .filter((tab) => tab.kind === "file" && isPathInside(tab.file.path, root))
        .map((tab) => tab.id),
    [stateRef],
  );

  // Close the window's workspace: stop watching it, close its tabs, drop the
  // tree + indexes. Loose file tabs stay open.
  const closeWorkspace = useCallback(async () => {
    const ws = workspaceRef.current;
    if (!ws) return;
    // Protect every dirty document in the workspace before tearing it down.
    if (!(await flushForClose(tabIdsInside(ws.root)))) return;
    invoke("unwatch_directory", { path: ws.root }).catch(() => {});
    closeWorkspaceTabs(ws.root);
    clearTree();
    clearIndexes();
  }, [clearIndexes, clearTree, closeWorkspaceTabs, flushForClose, tabIdsInside, workspaceRef]);

  // Create an empty folder and adopt it as a workspace, routing through the
  // same window manager as Open Folder.
  const createWorkspace = useCallback(async () => {
    const path = await pickNewWorkspace(t("common:fileDialog.newWorkspace"));
    if (typeof path !== "string") return;
    await invoke("request_open", { kind: "folder", path });
  }, [t]);

  // Open a folder as this window's workspace. With an explicit `root` (CLI,
  // session restore, a spawned window's injected open, or an `open-folder`
  // event) the folder is adopted into this window. With no root (the user's
  // Open Folder dialog) the choice is routed through the window manager so a
  // different folder opens a new window instead of replacing this one.
  const openFolder = useCallback(
    async (root?: string, openOptions?: OpenFolderOptions) => {
      if (!root) {
        const selected = await pickFolder();
        if (typeof selected !== "string") return;
        // No explicit root means a user "Open Folder" action: route it through
        // the window manager. A folder already open elsewhere focuses that
        // window; an empty current window adopts it (Rust emits `open-folder`
        // back to us); a different folder in an occupied window opens a new
        // window. This is what stops a second folder silently replacing the
        // current workspace.
        await invoke("request_open", { kind: "folder", path: selected });
        return;
      }
      if (workspaceRef.current?.root === root || folderOpenInFlight.current === root) {
        return;
      }

      // A workspace is one git repo's top level (#262). Refuse a folder nested
      // inside another Glyph workspace's `.glyph/` so workspace-wide features
      // have an unambiguous owner. A folder merely sitting inside a parent git
      // repo is still allowed (so `samples/` inside this repo opens) but earns a
      // persistent warning. Switching to a folder that overlaps the open one
      // just replaces the workspace, so there's nothing to refuse there. The
      // `silent` path (persisted-tab restore) skips the banner.
      const notify = (notice: WorkspaceNotice, persistent = false) => {
        if (openOptions?.silent) return;
        if (persistent) onWorkspaceNoticeRef.current(notice, { persistent: true });
        else onWorkspaceNoticeRef.current(notice);
      };
      let resolution: WorkspaceResolution;
      try {
        resolution = await resolveWorkspace(root);
      } catch (err) {
        notify({ key: "error.couldntOpen", values: { error: String(err) } });
        return;
      }
      if (resolution.glyphConflict) {
        notify({ key: "notice.nestedWorkspace", values: { path: resolution.glyphConflict } });
        return;
      }
      // Allowed, but a folder inside a parent git repo means workspace-wide
      // features (Sync, `.glyph/` config) resolve against that repo, so warn and
      // keep the notice up until the user dismisses it.
      if (resolution.nestedUnder) {
        notify({ key: "notice.nestedUnderGit", values: { path: resolution.nestedUnder } }, true);
      }

      folderOpenInFlight.current = root;
      try {
        // One workspace per window: switching folders replaces the current
        // one and closes its tabs (loose external files stay). Flush the
        // outgoing workspace's dirty tabs first; a cancelled discard aborts the
        // switch and keeps the current workspace open.
        const previous = workspaceRef.current;
        if (previous) {
          if (!(await flushForClose(tabIdsInside(previous.root)))) return;
          invoke("unwatch_directory", { path: previous.root }).catch(() => {});
          closeWorkspaceTabs(previous.root);
          resetStatus();
        }

        try {
          await invoke("watch_directory", { path: root });
        } catch (err) {
          console.error("Failed to watch directory:", err);
        }

        await openTree(root, openOptions?.expanded ?? []);
        const files = await scanWorkspace(root, () => workspaceRef.current?.root === root);

        // Auto-open the workspace's remembered file (or its first note) as a
        // document tab. Restore passes autoLoad: false because the persisted
        // tab list re-opens explicit tabs itself.
        if (openOptions?.autoLoad !== false && files.length > 0) {
          const remembered = await getWorkspaceLastFile(root).catch(() => null);
          const target = remembered && files.includes(remembered) ? remembered : files[0];
          if (isMarkdownFile(target)) {
            await openFile(target, { implicit: true });
          }
        }
      } finally {
        folderOpenInFlight.current = null;
      }
    },
    [
      closeWorkspaceTabs,
      flushForClose,
      openFile,
      openTree,
      resetStatus,
      scanWorkspace,
      tabIdsInside,
      workspaceRef,
    ],
  );

  return { openFolder, createWorkspace, closeWorkspace };
}
