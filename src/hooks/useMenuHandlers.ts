import { useCallback, useMemo } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useOpenGraph, useTabsContext } from "@/contexts/TabsContext";
import type { AppModals } from "@/hooks/useAppModals";
import { useCanSplit } from "@/hooks/useMediaQuery";
import type { MenuEventHandlers } from "@/hooks/useMenuEvents";
import { useSettings } from "@/hooks/useSettings";
import type { ShellControllers } from "@/hooks/useShellControllers";
import { openDocumentation, openReleaseNotes, openReportIssue } from "@/lib/helpLinks";
import { nextEditorMode } from "@/lib/settings";

interface UseMenuHandlersOptions {
  modals: AppModals;
  controllers: ShellControllers;
  /** Open the in-document find bar. */
  onFind: () => void;
}

/**
 * The app's single action bus. `useMenuEvents`, `useMenuShortcuts`, and the
 * command palette all dispatch through this one object, so a command behaves
 * identically however it was invoked.
 */
export function useMenuHandlers({
  modals,
  controllers,
  onFind,
}: UseMenuHandlersOptions): MenuEventHandlers {
  const { settings, updateSettings } = useSettings();
  const sidebar = useSidebarLayoutContext();
  const openGraphAction = useOpenGraph();
  const {
    activeFile,
    activeTabId,
    openFolder,
    createWorkspace,
    openFileDialog,
    newDocument,
    closeTab,
    closeWorkspace,
    setTabMode,
    saveDocument,
  } = useTabsContext();
  const { aiController, readAloud, printDoc, exporters, siteExporter, zoomActions } = controllers;
  const autoSave = settings.behavior.autoSave;

  const closeActiveTab = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  // Narrow (phone) viewports drop split from the cycle, so the toggle goes
  // view → edit → view.
  const canSplit = useCanSplit();
  const handleToggleEdit = useCallback(() => {
    if (!activeTabId) return;
    // nextEditorMode treats an undefined mode as view, so no fallback branch
    // is needed at the call site.
    setTabMode(activeTabId, nextEditorMode(activeFile?.mode, canSplit));
  }, [activeTabId, activeFile?.mode, setTabMode, canSplit]);

  const handleSave = useCallback(() => {
    if (activeTabId) saveDocument(activeTabId);
  }, [activeTabId, saveDocument]);

  const handleToggleAutoSave = useCallback(() => {
    updateSettings("behavior.autoSave", !autoSave);
  }, [autoSave, updateSettings]);

  return useMemo(
    () => ({
      newDocument,
      openFile: openFileDialog,
      openFolder: () => openFolder(),
      newWorkspace: createWorkspace,
      openGraph: openGraphAction,
      save: handleSave,
      toggleAutoSave: handleToggleAutoSave,
      closeTab: closeActiveTab,
      closeWorkspace,
      toggleFilesSidebar: sidebar.toggleFiles,
      toggleOutlineSidebar: sidebar.toggleOutline,
      resetView: sidebar.resetLayout,
      openSettings: modals.openSettings,
      managePlugins: modals.openPlugins,
      find: onFind,
      toggleEdit: handleToggleEdit,
      print: printDoc,
      exportHtml: exporters.exportHtml,
      exportDocx: exporters.exportDocx,
      exportEpub: exporters.exportEpub,
      exportPdf: exporters.exportPdf,
      exportWebsite: siteExporter.exportWebsite,
      workspaceSettings: modals.openWorkspaceSettings,
      zoomIn: () => zoomActions?.zoomIn(),
      zoomOut: () => zoomActions?.zoomOut(),
      zoomReset: () => zoomActions?.zoomReset(),
      aiAction: aiController.runAction,
      aiChat: aiController.togglePanel,
      readAloud: readAloud.toggle,
      // Static external links; module-level refs, so no deps entry needed.
      documentation: openDocumentation,
      releaseNotes: openReleaseNotes,
      reportIssue: openReportIssue,
    }),
    [
      newDocument,
      openFileDialog,
      openFolder,
      createWorkspace,
      openGraphAction,
      handleSave,
      handleToggleAutoSave,
      closeActiveTab,
      closeWorkspace,
      sidebar.toggleFiles,
      sidebar.toggleOutline,
      sidebar.resetLayout,
      modals.openSettings,
      modals.openPlugins,
      modals.openWorkspaceSettings,
      onFind,
      handleToggleEdit,
      printDoc,
      exporters.exportHtml,
      exporters.exportDocx,
      exporters.exportEpub,
      exporters.exportPdf,
      siteExporter.exportWebsite,
      zoomActions,
      aiController.runAction,
      aiController.togglePanel,
      readAloud.toggle,
    ],
  );
}
