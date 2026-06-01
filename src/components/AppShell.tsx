import { useCallback, useMemo, useState } from "react";
import { useSidebarLayoutContext } from "@/contexts/SidebarLayoutContext";
import { useTabsContext } from "@/contexts/TabsContext";
import { useAIController } from "@/hooks/useAIController";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useCommandPaletteController } from "@/hooks/useCommandPaletteController";
import { useContextMenu } from "@/hooks/useContextMenu";
import { useDocumentUndoRedo } from "@/hooks/useDocumentUndoRedo";
import { useErrorReporting } from "@/hooks/useErrorReporting";
import { useFontZoom } from "@/hooks/useFontZoom";
import { useMenuEvents } from "@/hooks/useMenuEvents";
import { useNativeMenuState } from "@/hooks/useNativeMenuState";
import { usePlatform } from "@/hooks/usePlatform";
import { usePrint } from "@/hooks/usePrint";
import { useReadAloudController } from "@/hooks/useReadAloudController";
import { useSettings } from "@/hooks/useSettings";
import { useWindowReveal } from "@/hooks/useWindowReveal";
import { EmptyState } from "./layout/EmptyState";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
import { TabBar } from "./layout/TabBar";
import { AIPanel } from "./modals/AIPanel";
import { CommandPalette } from "./modals/CommandPalette";
import { SettingsModal } from "./modals/settings/SettingsModal";
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

  const {
    tabs: openTabs,
    activeTab,
    activeFile,
    activeTabId,
    initializing,
    displayContent,
    openFolder,
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
  const zoom = useFontZoom({ fontSize: settings.appearance.fontSize, updateSettings });

  useNativeMenuState({
    hasTab: openTabs.length > 0,
    hasFile: activeFile?.content != null,
    hasContent: (displayContent ?? "").length > 0,
    aiConfigured: aiController.configured,
    ttsAvailable: tts.available,
  });

  const closeActiveTab = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  const handleToggleEdit = useCallback(() => {
    if (!activeTabId) return;
    const current = activeFile?.mode ?? "view";
    const next = current === "view" ? "edit" : current === "edit" ? "split" : "view";
    setTabMode(activeTabId, next);
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
      closeTab: closeActiveTab,
      toggleFilesSidebar: sidebar.toggleFiles,
      toggleOutlineSidebar: sidebar.toggleOutline,
      resetView: sidebar.resetLayout,
      openSettings: () => setSettingsOpen(true),
      find: () => setSearchOpen(true),
      toggleEdit: handleToggleEdit,
      print: printDoc,
      zoomIn: zoom.zoomIn,
      zoomOut: zoom.zoomOut,
      zoomReset: zoom.zoomReset,
      aiAction: handleAIActionFromMenu,
      readAloud: readAloud.toggle,
    }),
    [
      openFileDialog,
      openFolder,
      closeActiveTab,
      sidebar.toggleFiles,
      sidebar.toggleOutline,
      sidebar.resetLayout,
      handleToggleEdit,
      printDoc,
      zoom.zoomIn,
      zoom.zoomOut,
      zoom.zoomReset,
      handleAIActionFromMenu,
      readAloud.toggle,
    ],
  );
  useMenuEvents(menuHandlers);

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

  // Context menu (Win/Linux only): text-content actions only. Sidebar/menu/zoom
  // commands have their own keyboard shortcuts and titlebar buttons.
  const contextMenuActions = useMemo(
    () => ({
      openFileDialog,
      ttsSpeak: tts.speak,
      ttsStop: tts.stop,
      ttsSpeaking: tts.speaking,
      ttsAvailable: tts.available,
      aiAction: handleAIActionFromMenu,
      aiConfigured: aiController.configured,
      content: displayContent,
    }),
    [openFileDialog, tts, handleAIActionFromMenu, aiController.configured, displayContent],
  );
  useContextMenu(platform, contextMenuActions);

  const showEmptyState =
    !initializing && (!activeTab || (activeTab.kind === "folder" && !activeFile));
  const folderEmptyHint = activeTab?.kind === "folder" && !activeFile;
  const showContent = !!activeTab && !!activeFile?.content;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
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
      <StatusBar />

      <CommandPalette
        open={palette.open}
        query={palette.query}
        commands={palette.commands}
        onQueryChange={palette.setQuery}
        onClose={palette.close}
      />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
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
