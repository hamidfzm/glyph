import { useCallback, useMemo, useState } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useAIController } from "@/hooks/useAIController";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useCommandPaletteController } from "@/hooks/useCommandPaletteController";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useDocumentUndoRedo } from "@/hooks/useDocumentUndoRedo";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useExport } from "@/hooks/useExport";
import { useFontZoom } from "@/hooks/useFontZoom";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useNativeKeybindings } from "@/hooks/useNativeKeybindings";
import { useNativeMenuState } from "@/hooks/useNativeMenuState";
import { usePlatform } from "@/hooks/usePlatform";
import { usePrint } from "@/hooks/usePrint";
import { useReadAloudController } from "@/hooks/useReadAloudController";
import { useSettings } from "@/hooks/useSettings";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { nextEditorMode } from "@/lib/settings";
import { EmptyState } from "./layout/EmptyState";
import { ExportProgress } from "./layout/ExportProgress";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
import { TabBar } from "./layout/TabBar";
import { UpdateBanner } from "./layout/UpdateBanner";
import { WorkspaceNoticeBanner } from "./layout/WorkspaceNoticeBanner";
import { ContextMenu } from "./menu/ContextMenu";
import { AIPanel } from "./modals/AIPanel";
import { CommandPalette } from "./modals/CommandPalette";
import { SyncSettingsModal } from "./modals/SyncSettingsModal";
import { SettingsModal } from "./modals/settings/lazySettings";
import { TabContent } from "./TabContent";

// All the wiring that used to live inside App: menu events, AI/TTS/Print
// controllers, native-menu enable state, zoom, context menu, autosave. The
// component is "the shell"; the only reason it's not called App is that the
// real <App> is a tiny provider stack and we want both files to stay focused.
export function AppShell() {
  const platform = usePlatform();
  const { settings, updateSettings, loaded } = useSettings();
  const tabs = useTabsContext();
  const sidebar = useSidebarLayoutContext();

  // Opt-in crash/error reporting; inert in dev and until the user enables it.
  useErrorReporting(settings.privacy.errorReporting, loaded);

  // Reveal the window (created hidden in tauri.conf.json) once settings/theme
  // are loaded, avoiding the white flash + geometry jump on launch.
  useWindowReveal();

  // Once-per-session check for a newer GitHub release; the banner shows only
  // when the user has the feature on and an update is actually available.
  const updateCheck = useUpdateCheck(settings.behavior.checkForUpdates, loaded);

  const {
    tabs: openTabs,
    activeTab,
    activeFile,
    activeTabId,
    initializing,
    displayContent,
    openFolder,
    openGraph,
    openFileDialog,
    openFileInFolderTab,
    closeTab,
    setTabMode,
    markSaved,
    undoEdit,
    redoEdit,
    workspaceFiles,
    tocEntries,
  } = tabs;

  useDocumentUndoRedo({ activeTabId, platform, onUndo: undoEdit, onRedo: redoEdit });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useAutoSave({
    path: activeFile?.path,
    content: activeFile?.editContent ?? null,
    dirty: activeFile?.dirty ?? false,
    onSaved: useCallback(
      (savedContent: string) => {
        if (activeTabId) markSaved(activeTabId, savedContent);
      },
      [activeTabId, markSaved],
    ),
  });

  const aiController = useAIController(settings.ai);
  const readAloud = useReadAloudController(settings.ai, () => displayContent);
  const tts = readAloud.tts;
  const printDoc = usePrint({ entries: tabs.tocEntries, settings: settings.print });
  const exporters = useExport({
    entries: tabs.tocEntries,
    settings: settings.print,
    filePath: activeFile?.path,
    content: displayContent,
  });
  const zoom = useFontZoom({ fontSize: settings.appearance.fontSize, updateSettings });

  useNativeMenuState({
    hasTab: openTabs.length > 0,
    hasFile: activeFile?.content != null,
    hasContent: (displayContent ?? "").length > 0,
    hasWorkspace: activeTab?.kind === "folder" || activeTab?.kind === "graph",
    aiConfigured: aiController.configured,
    ttsAvailable: tts.available,
  });

  const closeActiveTab = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const handleToggleEdit = useCallback(() => {
    if (!activeTabId) return;
    // nextEditorMode treats an undefined mode as view, so no fallback branch
    // is needed at the call site.
    setTabMode(activeTabId, nextEditorMode(activeFile?.mode));
  }, [activeTabId, activeFile?.mode, setTabMode]);

  const handleAIActionFromMenu = useCallback(
    (action: string) => {
      const text = displayContent ?? "";
      if (text) aiController.runAction(action, text);
    },
    [aiController, displayContent],
  );

  const menuHandlers = useMemo(
    () => ({
      openFile: openFileDialog,
      openFolder: () => openFolder(),
      // No-arg wrapper: menu/palette callers must not leak their event
      // payload into openGraph's optional root parameter.
      openGraph: () => openGraph(),
      closeTab: closeActiveTab,
      toggleFilesSidebar: sidebar.toggleFiles,
      toggleOutlineSidebar: sidebar.toggleOutline,
      resetView: sidebar.resetLayout,
      openSettings: () => setSettingsOpen(true),
      openSyncSettings: () => setSyncSettingsOpen(true),
      find: () => setSearchOpen(true),
      toggleEdit: handleToggleEdit,
      print: printDoc,
      exportHtml: exporters.exportHtml,
      exportDocx: exporters.exportDocx,
      exportEpub: exporters.exportEpub,
      exportPdf: exporters.exportPdf,
      zoomIn: zoom.zoomIn,
      zoomOut: zoom.zoomOut,
      zoomReset: zoom.zoomReset,
      aiAction: handleAIActionFromMenu,
      readAloud: readAloud.toggle,
    }),
    [
      openFileDialog,
      openFolder,
      openGraph,
      closeActiveTab,
      sidebar.toggleFiles,
      sidebar.toggleOutline,
      sidebar.resetLayout,
      handleToggleEdit,
      printDoc,
      exporters.exportHtml,
      exporters.exportDocx,
      exporters.exportEpub,
      exporters.exportPdf,
      zoom.zoomIn,
      zoom.zoomOut,
      zoom.zoomReset,
      handleAIActionFromMenu,
      readAloud.toggle,
    ],
  );
  useMenuEvents(menuHandlers);
  useNativeKeybindings();

  const palette = useCommandPaletteController({
    platform,
    activeFolderTab: activeTab?.kind === "folder" ? activeTab : null,
    workspaceFiles,
    tocEntries,
    actions: useMemo(
      () => ({ ...menuHandlers, openFileInFolderTab }),
      [menuHandlers, openFileInFolderTab],
    ),
  });

  // Themed right-click menu for the markdown viewer: text-content actions only.
  // The file tree owns its own menu; menu/zoom commands have shortcuts/buttons.
  const contextMenuActions = useMemo(
    () => ({
      ttsSpeak: tts.speak,
      ttsStop: tts.stop,
      ttsSpeaking: tts.speaking,
      ttsAvailable: tts.available,
      aiAction: handleAIActionFromMenu,
      aiConfigured: aiController.configured,
      content: displayContent,
    }),
    [tts, handleAIActionFromMenu, aiController.configured, displayContent],
  );
  const contextMenu = useContextMenu(contextMenuActions);

  const showEmptyState =
    !initializing && (!activeTab || (activeTab.kind === "folder" && !activeFile));
  const folderEmptyHint = activeTab?.kind === "folder" && !activeFile;
  // Graph tabs have no file but always render content (the canvas).
  const showContent = !!activeTab && (activeTab.kind === "graph" || !!activeFile?.content);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <UpdateBanner update={updateCheck.update} onDismiss={updateCheck.dismiss} />
      <WorkspaceNoticeBanner
        notice={tabs.workspaceNotice}
        onDismiss={tabs.dismissWorkspaceNotice}
      />
      <TabBar />
      <div className="flex flex-1 min-h-0">
        <Sidebar side="left" />
        {showContent ? (
          <TabContent searchOpen={searchOpen} onSearchClose={() => setSearchOpen(false)} />
        ) : showEmptyState ? (
          <div className="flex-1">
            <EmptyState
              platform={platform}
              onOpenFile={openFileDialog}
              onOpenFolder={() => openFolder()}
              hint={folderEmptyHint ? "Pick a file from the sidebar to start reading." : undefined}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Sidebar side="right" />
      </div>
      <StatusBar onOpenSync={() => setSyncSettingsOpen(true)} />

      {exporters.exporting && <ExportProgress format={exporters.exporting} />}

      <CommandPalette
        open={palette.open}
        query={palette.query}
        commands={palette.commands}
        onQueryChange={palette.setQuery}
        onClose={palette.close}
      />

      <ContextMenu menu={contextMenu.menu} onClose={contextMenu.close} />

      {/* Mounted only when open so the settings chunk loads on first use. */}
      {settingsOpen && <SettingsModal open onClose={() => setSettingsOpen(false)} />}
      {syncSettingsOpen && <SyncSettingsModal open onClose={() => setSyncSettingsOpen(false)} />}
      <AIPanel
        open={aiController.panelOpen}
        onClose={aiController.closePanel}
        loading={aiController.ai.loading}
        result={aiController.ai.result}
        error={aiController.ai.error}
        action={aiController.ai.action}
        onReadAloud={tts.available ? tts.speak : undefined}
        speaking={tts.speaking}
        onStopReading={tts.stop}
      />
    </div>
  );
}
