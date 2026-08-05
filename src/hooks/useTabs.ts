import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentEdits } from "@/hooks/useDocumentEdits";
import { useDocumentSave } from "@/hooks/useDocumentSave";
import { useOpenDocument } from "@/hooks/useOpenDocument";
import { useSelfSaveTracker } from "@/hooks/useSelfSaveTracker";
import { useTabEvents } from "@/hooks/useTabEvents";
import { useTabStrip } from "@/hooks/useTabStrip";
import { useTabsSession } from "@/hooks/useTabsSession";
import type { UnsavedChoice } from "@/hooks/useUnsavedChangesPrompt";
import { useWorkspaceIndex } from "@/hooks/useWorkspaceIndex";
import { useWorkspaceLifecycle } from "@/hooks/useWorkspaceLifecycle";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import { useWorkspaceTree } from "@/hooks/useWorkspaceTree";
import { basename, isPathInside } from "@/lib/paths";
import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import { type FileTab, type PersistedTab, removeTabs } from "@/lib/tabs";

const MAX_RECENT_FILES = 10;

interface UseTabsOptions {
  reopenLastFile: boolean;
  openTabs: PersistedTab[] | string[]; // legacy: string[] = file-only persistence
  activeTabPath: string;
  recentFiles: string[];
  autoReload: boolean;
  autoSave: boolean;
  defaultEditorMode: EditorMode;
  onSettingsChange: (key: string, value: unknown) => void;
  // Only consulted with autosave off (#563).
  confirmUnsaved: (paths: string[]) => Promise<UnsavedChoice>;
  // Called to surface a workspace notice (see #262): a refusal (a folder nested
  // inside another Glyph workspace) or a `persistent` warning (a folder opened
  // despite sitting inside a parent git repo). The provider surfaces it as a
  // banner.
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

/**
 * The window's documents: the tab strip, its single folder workspace, and the
 * lifecycle that ties them together. Each concern lives in its own hook —
 * `useTabStrip`, `useWorkspaceTree`, `useWorkspaceIndex`, `useOpenDocument`,
 * `useDocumentSave`, `useDocumentEdits`, `useWorkspaceLifecycle`,
 * `useTabsSession`, `useTabEvents`. This hook wires them together and owns only
 * the operations that touch more than one.
 */
export function useTabs(options: UseTabsOptions) {
  const { t } = useTranslation("workspace");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const {
    setState,
    stateRef,
    tabs,
    activeTab,
    activeTabId,
    activeFile,
    setActiveTab,
    activateTabByPath,
    moveTab,
    moveActiveTab,
    updateActiveFile,
    setTabMode,
    updateEditContent,
    saveScrollPosition,
    forgetScroll,
  } = useTabStrip();

  // Re-point every open file tab under `oldPath` to its location under
  // `newPath`, moving the file watchers along. Used by rename and move.
  const repointOpenFiles = useCallback(
    (oldPath: string, newPath: string) => {
      for (const tab of stateRef.current.tabs) {
        if (tab.kind !== "file" || !isPathInside(tab.file.path, oldPath)) continue;
        const moved = newPath + tab.file.path.slice(oldPath.length);
        invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
        invoke("watch_file", { path: moved }).catch(() => {});
      }
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) => {
          if (tab.kind !== "file" || !isPathInside(tab.file.path, oldPath)) return tab;
          const moved = newPath + tab.file.path.slice(oldPath.length);
          return { ...tab, file: { ...tab.file, path: moved } };
        }),
      }));
    },
    [setState, stateRef],
  );

  const {
    workspace,
    workspaceRef,
    openTree,
    clearTree,
    refreshLoadedDirs,
    toggleExpand,
    collapseAll,
    expandAll,
    createEntry,
    renamePath,
    duplicatePath,
    movePath,
    deleteEntry,
  } = useWorkspaceTree({ repointOpenFiles });

  const {
    workspaceFiles,
    wikilinkRefs,
    metadataEntries,
    indexStatus,
    scanWorkspace,
    refreshIndexes,
    clearIndexes,
    resetStatus,
  } = useWorkspaceIndex({
    workspaceRoot: workspace?.root ?? null,
    onWorkspaceNotice: options.onWorkspaceNotice,
  });

  const { markSelfSave, isRecentSelfSave } = useSelfSaveTracker();

  const addToRecent = useCallback((path: string) => {
    const current = optionsRef.current.recentFiles ?? [];
    const updated = [path, ...current.filter((f) => f !== path)].slice(0, MAX_RECENT_FILES);
    optionsRef.current.onSettingsChange("behavior.recentFiles", updated);
  }, []);

  const getDefaultEditorMode = useCallback(() => optionsRef.current.defaultEditorMode, []);

  const { openFile, newDocument, openGraph, openFileDialog } = useOpenDocument({
    stateRef,
    setState,
    workspaceRef,
    addToRecent,
    getDefaultEditorMode,
  });

  const getWorkspaceRoot = useCallback(() => workspaceRef.current?.root ?? null, [workspaceRef]);

  const { saveDocument } = useDocumentSave({
    stateRef,
    setState,
    updateActiveFile,
    addToRecent,
    getWorkspaceRoot,
    onWorkspaceNotice: options.onWorkspaceNotice,
    markSelfSave,
  });

  const { toggleTask, commitEdit, undoEdit, redoEdit, forgetHistory } = useDocumentEdits({
    stateRef,
    updateActiveFile,
    markSelfSave,
  });

  // The single close coordinator: every destructive lifecycle path (tab close,
  // workspace close/replace, window close) flushes through it.
  const flushForClose = useCallback(
    async (ids?: Iterable<string>): Promise<boolean> => {
      const scope = ids ? new Set(ids) : null;
      const dirtyTabs = () =>
        stateRef.current.tabs.filter(
          (tab): tab is FileTab =>
            tab.kind === "file" && tab.file.dirty && (!scope || scope.has(tab.id)),
        );
      let dirty = dirtyTabs();
      if (dirty.length === 0) return true;

      // With autosave off the user decides when a file hits disk (#563).
      if (!optionsRef.current.autoSave) {
        const choice = await optionsRef.current.confirmUnsaved(dirty.map((tab) => tab.file.path));
        if (choice === "cancel") return false;
        if (choice === "discard") return true;
        // The prompt is open for an unbounded time, so flush what is dirty now
        // rather than the snapshot it listed; edits made meanwhile still land.
        dirty = dirtyTabs();
      }

      // Flush every dirty document and wait for the writes to settle. Each save
      // reports its own success, so a failed write can't be missed by a
      // dirty-flag read that hasn't re-rendered yet.
      const saved = await Promise.all(dirty.map((tab) => saveDocument(tab.id)));
      const unsaved = dirty.filter((_, i) => !saved[i]);
      if (unsaved.length === 0) return true;

      // Some documents couldn't be saved; closing now would drop those edits,
      // so confirm an explicit discard.
      const files = unsaved.map((tab) => `• ${basename(tab.file.path)}`).join("\n");
      return ask(t("unsavedChanges.message", { files }), {
        title: t("unsavedChanges.title"),
        kind: "warning",
        okLabel: t("unsavedChanges.discard"),
        cancelLabel: t("unsavedChanges.cancel"),
      });
    },
    [saveDocument, stateRef, t],
  );

  const { openFolder, createWorkspace, closeWorkspace } = useWorkspaceLifecycle({
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
    onWorkspaceNotice: options.onWorkspaceNotice,
  });

  const createNote = useCallback((dir: string) => createEntry(dir, "note"), [createEntry]);
  const createCanvas = useCallback((dir: string) => createEntry(dir, "canvas"), [createEntry]);
  const createFolder = useCallback((dir: string) => createEntry(dir, "folder"), [createEntry]);

  // Create a note or board at the workspace root and open it in edit mode:
  // both are empty, so the read-only view (which canvases default to) would
  // have nothing to show.
  const createInWorkspace = useCallback(
    async (kind: "note" | "canvas") => {
      const ws = workspaceRef.current;
      if (!ws) return;
      const path = await createEntry(ws.root, kind);
      if (!path) return;
      await openFile(path);
      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((tab) =>
          tab.kind === "file" && tab.file.path === path
            ? {
                ...tab,
                file: { ...tab.file, mode: EDITOR_MODE.edit, editContent: tab.file.content },
              }
            : tab,
        ),
      }));
    },
    [createEntry, openFile, setState, workspaceRef],
  );

  const createNoteInWorkspace = useCallback(() => createInWorkspace("note"), [createInWorkspace]);
  const createCanvasInWorkspace = useCallback(
    () => createInWorkspace("canvas"),
    [createInWorkspace],
  );

  // Delete a note/folder after confirming, then close any tabs under it.
  const deletePath = useCallback(
    async (path: string): Promise<boolean> => {
      if (!(await deleteEntry(path))) return false;
      setState((prev) => {
        const removedIds = new Set<string>();
        for (const tab of prev.tabs) {
          if (tab.kind === "file" && isPathInside(tab.file.path, path)) {
            invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
            forgetScroll(tab.id);
            forgetHistory(tab.id);
            removedIds.add(tab.id);
          }
        }
        return removeTabs(prev, removedIds);
      });
      return true;
    },
    [deleteEntry, forgetHistory, forgetScroll, setState],
  );

  // One flush for the whole batch, so a cancelled save leaves every tab of the
  // set open instead of the ones already walked past.
  const closeTabs = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return;
      if (!(await flushForClose(ids))) return;
      setState((prev) => {
        const removedIds = new Set<string>();
        for (const id of ids) {
          const tab = prev.tabs.find((candidate) => candidate.id === id);
          if (!tab) continue;
          if (tab.kind === "file") {
            invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
          }
          forgetScroll(id);
          forgetHistory(id);
          removedIds.add(id);
        }
        return removeTabs(prev, removedIds);
      });
    },
    [flushForClose, forgetHistory, forgetScroll, setState],
  );

  const closeTab = useCallback((id: string) => closeTabs([id]), [closeTabs]);

  const { initializing } = useTabsSession({
    optionsRef,
    tabs,
    activeTab,
    workspace,
    openFile,
    openFolder,
    openGraph,
    activateTabByPath,
  });

  const refreshWorkspace = useCallback(
    async (root: string) => {
      const isCurrent = () => workspaceRef.current?.root === root;
      await Promise.all([refreshLoadedDirs(root), refreshIndexes(root, isCurrent)]);
    },
    [refreshIndexes, refreshLoadedDirs, workspaceRef],
  );

  const isAutoReloadEnabled = useCallback(() => optionsRef.current.autoReload, []);

  useTabEvents({
    stateRef,
    setState,
    workspaceRef,
    openFile,
    openFolder,
    isAutoReloadEnabled,
    isRecentSelfSave,
    forgetHistory,
    refreshWorkspace,
  });

  return {
    tabs,
    activeTab,
    activeTabId,
    activeFile,
    initializing,
    workspace,
    workspaceFiles,
    wikilinkRefs,
    metadataEntries,
    indexStatus,
    openFile,
    newDocument,
    openFolder,
    createWorkspace,
    openGraph,
    closeWorkspace,
    toggleExpand,
    createNote,
    createNoteInWorkspace,
    createCanvasInWorkspace,
    createCanvas,
    createFolder,
    commitEdit,
    renamePath,
    duplicatePath,
    movePath,
    collapseAll,
    expandAll,
    deletePath,
    closeTab,
    closeTabs,
    flushForClose,
    setActiveTab,
    moveTab,
    moveActiveTab,
    setTabMode,
    updateEditContent,
    saveDocument,
    toggleTask,
    undoEdit,
    redoEdit,
    saveScrollPosition,
    openFileDialog,
  };
}
