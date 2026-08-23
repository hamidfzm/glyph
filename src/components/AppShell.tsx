import { useCallback, useMemo, useState } from "react";
import { useTabsContext } from "@/contexts/TabsContext";
import { useAppModals } from "@/hooks/useAppModals";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useCliExport } from "@/hooks/useCliExport";
import { useCloseFlush } from "@/hooks/useCloseFlush";
import { useCommandPaletteController } from "@/hooks/useCommandPaletteController";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useDocumentUndoRedo } from "@/hooks/useDocumentUndoRedo";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useMenuHandlers } from "@/hooks/useMenuHandlers";
import { useMenuShortcuts } from "@/hooks/useMenuShortcuts";
import { useNativeKeybindings } from "@/hooks/useNativeKeybindings";
import { useNativeMenuLabels } from "@/hooks/useNativeMenuLabels";
import { useNativeMenuState } from "@/hooks/useNativeMenuState";
import { useNavigationShortcuts } from "@/hooks/useNavigationShortcuts";
import { usePlatform } from "@/hooks/usePlatform";
import { usePluginWorkspaceSync } from "@/hooks/usePluginWorkspaceSync";
import { useSettings } from "@/hooks/useSettings";
import { useShellControllers } from "@/hooks/useShellControllers";
import { useTabReorderShortcuts } from "@/hooks/useTabReorderShortcuts";
import { useWindowClose } from "@/hooks/useWindowClose";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { isImageFile } from "@/lib/imageExtensions";
import { AIChatPanel } from "./ai/lazyAIChatPanel";
import { AppBanners } from "./layout/AppBanners";
import { AppModals } from "./layout/AppModals";
import { EmptyState } from "./layout/EmptyState";
import { ExportProgress } from "./layout/ExportProgress";
import { Sidebar } from "./layout/Sidebar";
import { SidebarDrawerBackdrop } from "./layout/SidebarDrawerBackdrop";
import { StatusBar } from "./layout/StatusBar";
import { TabBar } from "./layout/TabBar";
import { ContextMenu } from "./menu/ContextMenu";
import { CommandPalette } from "./modals/CommandPalette";
import { TabContent } from "./TabContent";

// All the wiring that used to live inside App: menu events, AI/TTS/Print
// controllers, native-menu enable state, zoom, context menu, autosave. The
// component is "the shell"; the only reason it's not called App is that the
// real <App> is a tiny provider stack and we want both files to stay focused.
export function AppShell() {
  const platform = usePlatform();
  const { settings, loaded } = useSettings();
  const tabs = useTabsContext();

  // Opt-in crash/error reporting; inert in dev and until the user enables it.
  useErrorReporting(settings.privacy.errorReporting, loaded);

  // Reveal the window (created hidden in tauri.conf.json) once settings/theme
  // are loaded, avoiding the white flash + geometry jump on launch.
  useWindowReveal();

  // Keep the plugin host's workspace scope in sync with the open workspace.
  usePluginWorkspaceSync();

  const {
    tabs: openTabs,
    activeTab,
    activeFile,
    activeTabId,
    initializing,
    displayContent,
    workspace,
    openFolder,
    createWorkspace,
    openFile,
    openFileDialog,
    newDocument,
    createNoteInWorkspace,
    createCanvasInWorkspace,
    saveDocument,
    flushForClose,
    undoEdit,
    redoEdit,
    moveActiveTab,
    navigateBack,
    navigateForward,
    workspaceFiles,
    tocEntries,
  } = tabs;

  // Headless CLI export: runs and exits when the process was launched with
  // --export, a no-op otherwise.
  useCliExport({ entries: tocEntries, content: displayContent });

  useDocumentUndoRedo({ activeTabId, platform, onUndo: undoEdit, onRedo: redoEdit });
  useTabReorderShortcuts({ platform, onMove: moveActiveTab });
  useNavigationShortcuts({ platform });

  const [searchOpen, setSearchOpen] = useState(false);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const modals = useAppModals();

  // Autosave every dirty editable tab, not just the active one, so switching
  // tabs never cancels another document's pending save. Each carries its
  // revision so the scheduler can debounce per document. With autosave off the
  // list is empty, so nothing is scheduled (Save and close-flush still work).
  const autoSave = settings.behavior.autoSave;
  const dirtyDocuments = useMemo(
    () =>
      autoSave
        ? openTabs
            .filter((t) => t.kind === "file" && t.file.dirty)
            .map((t) => ({ id: t.id, revision: t.file?.revision ?? 0 }))
        : [],
    [openTabs, autoSave],
  );
  useAutoSave({ documents: dirtyDocuments, save: saveDocument });

  // Intercept native window close / app exit: flush pending settings and every
  // dirty tab (confirming on failure) before the window is allowed to close.
  useWindowClose(useCloseFlush(flushForClose));

  const controllers = useShellControllers();
  const { aiController, tts, exporters, siteExporter, runPluginExporter } = controllers;

  useNativeMenuState({
    hasTab: openTabs.length > 0,
    hasFile: activeFile?.content != null,
    hasContent: (displayContent ?? "").length > 0,
    hasWorkspace: workspace !== null,
    aiConfigured: aiController.configured,
    ttsAvailable: tts.available,
    hasDirty: activeFile?.dirty ?? false,
    autoSave,
  });
  useNativeMenuLabels();

  const menuHandlers = useMenuHandlers({ modals, controllers, onFind: openSearch });
  useMenuEvents(menuHandlers);
  useMenuShortcuts({ platform, handlers: menuHandlers });
  useNativeKeybindings();

  const palette = useCommandPaletteController({
    platform,
    workspaceOpen: workspace !== null,
    workspaceFiles,
    tocEntries,
    actions: useMemo(
      () => ({
        ...menuHandlers,
        openSyncSettings: modals.openSyncSettings,
        openWorkspaceFile: openFile,
        runPluginExporter,
        navigateBack,
        navigateForward,
      }),
      [
        menuHandlers,
        modals.openSyncSettings,
        openFile,
        runPluginExporter,
        navigateBack,
        navigateForward,
      ],
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
  // A file tab shows its pane once content has loaded (content != null; the
  // empty string is loaded, not absent), or immediately for images, which carry
  // no text content and render straight from the asset path.
  const showDocument =
    activeFile != null && (activeFile.content != null || isImageFile(activeFile.path));
  // Graph tabs have no file but always render (the canvas).
  const showContent = activeTab?.kind === "graph" || showDocument;

  return (
    // Safe-area insets pad the whole shell so whatever sits at each edge (a
    // banner or the tab bar at the top, the status bar at the bottom) clears
    // the status bar, cutout, and home indicator. The bottom bar adds its own
    // gesture-nav floor on top of this (see .status-bar).
    <div
      className="flex flex-col h-full bg-[var(--color-surface)]"
      style={{
        paddingTop: "var(--glyph-safe-top)",
        paddingLeft: "var(--glyph-safe-left)",
        paddingRight: "var(--glyph-safe-right)",
      }}
    >
      <AppBanners />
      <TabBar
        onToggleAIChat={aiController.configured ? aiController.togglePanel : null}
        onOpenPalette={palette.openPalette}
      />
      <div className="relative flex flex-1 min-h-0">
        <SidebarDrawerBackdrop />
        <Sidebar side="left" />
        {showContent ? (
          <TabContent searchOpen={searchOpen} onSearchClose={closeSearch} />
        ) : showEmptyState ? (
          <div className="flex-1">
            <EmptyState
              platform={platform}
              onNewDocument={newDocument}
              onOpenFile={openFileDialog}
              onOpenFolder={() => openFolder()}
              onNewWorkspace={createWorkspace}
              onNewNote={createNoteInWorkspace}
              onNewCanvas={createCanvasInWorkspace}
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
      <StatusBar onOpenSync={modals.openSyncSettings} />

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

      <AppModals modals={modals} />
    </div>
  );
}
