import { useCallback, useMemo, useState } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useAIController } from "@/hooks/useAIController";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useCliExport } from "@/hooks/useCliExport";
import { useCommandPaletteController } from "@/hooks/useCommandPaletteController";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useDocumentUndoRedo } from "@/hooks/useDocumentUndoRedo";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useExport } from "@/hooks/useExport";
import { useExportSite } from "@/hooks/useExportSite";
import { useFontZoom } from "@/hooks/useFontZoom";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useNativeKeybindings } from "@/hooks/useNativeKeybindings";
import { useNativeMenuLabels } from "@/hooks/useNativeMenuLabels";
import { useNativeMenuState } from "@/hooks/useNativeMenuState";
import { usePlatform } from "@/hooks/usePlatform";
import { usePluginExporterRunner } from "@/hooks/usePluginExporterRunner";
import { usePluginWorkspaceSync } from "@/hooks/usePluginWorkspaceSync";
import { usePrint } from "@/hooks/usePrint";
import { useReadAloudController } from "@/hooks/useReadAloudController";
import { useSettings } from "@/hooks/useSettings";
import { useTabReorderShortcuts } from "@/hooks/useTabReorderShortcuts";
import { useUpdateCheck } from "@/hooks/useUpdateCheck";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { aiDocContext } from "@/lib/aiPrompts";
import { openDocumentation, openReleaseNotes, openReportIssue } from "@/lib/helpLinks";
import { isImageFile } from "@/lib/imageExtensions";
import { nextEditorMode } from "@/lib/settings";
import { AIChatPanel } from "./ai/AIChatPanel";
import { EmptyState } from "./layout/EmptyState";
import { ExportProgress } from "./layout/ExportProgress";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
import { TabBar } from "./layout/TabBar";
import { UpdateBanner } from "./layout/UpdateBanner";
import { WorkspaceNoticeBanner } from "./layout/WorkspaceNoticeBanner";
import { ContextMenu } from "./menu/ContextMenu";
import { CommandPalette } from "./modals/CommandPalette";
import { SyncSettingsModal } from "./modals/SyncSettingsModal";
import { SettingsModal } from "./modals/settings/lazySettings";
import { PluginsModal } from "./plugins/PluginsModal";
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

  // Keep the plugin host's workspace scope in sync with the open workspace.
  usePluginWorkspaceSync();

  // Headless CLI website export: runs and exits when the process was launched
  // with --export-website, a no-op otherwise.
  useCliExport();

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
    workspace,
    openFolder,
    openGraph,
    openFile,
    openFileDialog,
    closeTab,
    setTabMode,
    saveDocument,
    undoEdit,
    redoEdit,
    moveActiveTab,
    workspaceFiles,
    tocEntries,
  } = tabs;

  useDocumentUndoRedo({ activeTabId, platform, onUndo: undoEdit, onRedo: redoEdit });
  useTabReorderShortcuts({ platform, onMove: moveActiveTab });

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncSettingsOpen, setSyncSettingsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Autosave every dirty editable tab, not just the active one, so switching
  // tabs never cancels another document's pending save. Each carries its
  // revision so the scheduler can debounce per document.
  const dirtyDocuments = useMemo(
    () =>
      openTabs
        .filter((t) => t.kind === "file" && t.file.dirty)
        .map((t) => ({ id: t.id, revision: t.file?.revision ?? 0 })),
    [openTabs],
  );
  useAutoSave({ documents: dirtyDocuments, save: saveDocument });

  const aiController = useAIController(
    settings.ai,
    aiDocContext({
      path: activeFile?.path,
      content: displayContent,
      workspaceRoot: workspace?.root,
      workspaceFiles,
    }),
  );
  const readAloud = useReadAloudController(settings.ai, () => displayContent);
  const tts = readAloud.tts;
  const printDoc = usePrint({ entries: tabs.tocEntries, settings: settings.print });
  const exporters = useExport({
    entries: tabs.tocEntries,
    settings: settings.print,
    filePath: activeFile?.path,
    content: displayContent,
  });
  const siteExporter = useExportSite(workspace?.root);
  const zoom = useFontZoom({ fontSize: settings.appearance.fontSize, updateSettings });
  const runPluginExporter = usePluginExporterRunner({
    entries: tabs.tocEntries,
    filePath: activeFile?.path,
    content: displayContent,
  });

  useNativeMenuState({
    hasTab: openTabs.length > 0,
    hasFile: activeFile?.content != null,
    hasContent: (displayContent ?? "").length > 0,
    hasWorkspace: workspace !== null,
    aiConfigured: aiController.configured,
    ttsAvailable: tts.available,
  });
  useNativeMenuLabels();

  const closeActiveTab = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const handleToggleEdit = useCallback(() => {
    if (!activeTabId) return;
    // nextEditorMode treats an undefined mode as view, so no fallback branch
    // is needed at the call site.
    setTabMode(activeTabId, nextEditorMode(activeFile?.mode));
  }, [activeTabId, activeFile?.mode, setTabMode]);

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
      managePlugins: () => setPluginsOpen(true),
      find: () => setSearchOpen(true),
      toggleEdit: handleToggleEdit,
      print: printDoc,
      exportHtml: exporters.exportHtml,
      exportDocx: exporters.exportDocx,
      exportEpub: exporters.exportEpub,
      exportPdf: exporters.exportPdf,
      exportWebsite: siteExporter.exportWebsite,
      zoomIn: zoom.zoomIn,
      zoomOut: zoom.zoomOut,
      zoomReset: zoom.zoomReset,
      aiAction: aiController.runAction,
      aiChat: aiController.togglePanel,
      readAloud: readAloud.toggle,
      // Static external links; module-level refs, so no deps entry needed.
      documentation: openDocumentation,
      releaseNotes: openReleaseNotes,
      reportIssue: openReportIssue,
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
      siteExporter.exportWebsite,
      zoom.zoomIn,
      zoom.zoomOut,
      zoom.zoomReset,
      aiController.runAction,
      aiController.togglePanel,
      readAloud.toggle,
    ],
  );
  useMenuEvents(menuHandlers);
  useNativeKeybindings();

  const palette = useCommandPaletteController({
    platform,
    workspaceOpen: workspace !== null,
    workspaceFiles,
    tocEntries,
    actions: useMemo(
      () => ({
        ...menuHandlers,
        openWorkspaceFile: openFile,
        runPluginExporter,
      }),
      [menuHandlers, openFile, runPluginExporter],
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
      aiAction: aiController.runAction,
      aiConfigured: aiController.configured,
      content: displayContent,
    }),
    [tts, aiController.runAction, aiController.configured, displayContent],
  );
  const contextMenu = useContextMenu(contextMenuActions);

  const showEmptyState = !initializing && !activeTab;
  // With a workspace open but no tabs, nudge toward the sidebar tree.
  const folderEmptyHint = workspace !== null && !activeTab;
  // Graph tabs have no file but always render content (the canvas). Image tabs
  // carry no text content (it stays null — they render from the asset path), so
  // gate them on the path, not on content, or they fall through to a blank pane.
  const showContent =
    !!activeTab &&
    (activeTab.kind === "graph" ||
      !!activeFile?.content ||
      (!!activeFile && isImageFile(activeFile.path)));

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <UpdateBanner update={updateCheck.update} onDismiss={updateCheck.dismiss} />
      <WorkspaceNoticeBanner
        notice={tabs.workspaceNotice}
        onDismiss={tabs.dismissWorkspaceNotice}
      />
      <TabBar onToggleAIChat={aiController.configured ? aiController.togglePanel : null} />
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
              folderEmpty={folderEmptyHint}
            />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        <Sidebar side="right" />
        <AIChatPanel
          open={aiController.panelOpen}
          onClose={aiController.closePanel}
          turns={aiController.chat.turns}
          streaming={aiController.chat.streaming}
          error={aiController.chat.error}
          configured={aiController.configured}
          hasDocument={(displayContent ?? "").length > 0}
          onSend={aiController.chat.send}
          onStop={aiController.chat.stop}
          onClear={aiController.chat.clear}
          onQuickAction={aiController.runAction}
          onReadAloud={tts.available ? tts.speak : undefined}
          speaking={tts.speaking}
          onStopReading={tts.stop}
        />
      </div>
      <StatusBar onOpenSync={() => setSyncSettingsOpen(true)} />

      {exporters.exporting && <ExportProgress format={exporters.exporting} />}
      {siteExporter.siteProgress && (
        <ExportProgress format="website" progress={siteExporter.siteProgress} />
      )}

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
      {pluginsOpen && <PluginsModal onClose={() => setPluginsOpen(false)} />}
    </div>
  );
}
