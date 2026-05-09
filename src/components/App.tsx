import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type AIAction, useAI } from "../hooks/useAI";
import { useAutoSave } from "../hooks/useAutoSave";
import { useContextMenu } from "../hooks/useContextMenu";
import { usePlatform } from "../hooks/usePlatform";
import { usePrint } from "../hooks/usePrint";
import { useSettings } from "../hooks/useSettings";
import { useTableOfContents } from "../hooks/useTableOfContents";
import { activeFileOf, useTabs } from "../hooks/useTabs";
import { useTaskList } from "../hooks/useTaskList";
import { useTheme } from "../hooks/useTheme";
import { useTTS } from "../hooks/useTTS";
import { filterBacklinks } from "../lib/backlinks";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../lib/settings";
// Code theme CSS (inline imports for production compatibility)
import glyphThemeCSS from "../styles/highlight.css?inline";
import githubThemeCSS from "../styles/highlight-github.css?inline";
import monokaiThemeCSS from "../styles/highlight-monokai.css?inline";
import nordThemeCSS from "../styles/highlight-nord.css?inline";
import solarizedDarkThemeCSS from "../styles/highlight-solarized-dark.css?inline";
import solarizedLightThemeCSS from "../styles/highlight-solarized-light.css?inline";
import { MarkdownEditor, SplitView } from "./editor/lazyEditor";
import { EmptyState } from "./layout/EmptyState";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
import { TabBar } from "./layout/TabBar";
import { MarkdownViewer } from "./markdown/MarkdownViewer";
import { AIPanel } from "./modals/AIPanel";
import { SettingsModal } from "./modals/SettingsModal";

const CODE_THEMES: Record<string, string> = {
  glyph: glyphThemeCSS,
  github: githubThemeCSS,
  monokai: monokaiThemeCSS,
  nord: nordThemeCSS,
  "solarized-light": solarizedLightThemeCSS,
  "solarized-dark": solarizedDarkThemeCSS,
};

export function App() {
  const platform = usePlatform();
  const { settings, updateSettings } = useSettings();

  // Pass settings theme override to useTheme
  useTheme(settings.appearance.theme);

  const {
    tabs,
    activeTab,
    activeTabId,
    activeFile,
    initializing,
    workspaceFiles,
    wikilinkRefs,
    openFile,
    openFolder,
    openFileInFolderTab,
    toggleExpand,
    closeTab,
    setActiveTab,
    setTabMode,
    updateEditContent,
    markSaved,
    toggleTask,
    saveScrollPosition,
    openFileDialog,
  } = useTabs({
    reopenLastFile: settings.behavior.reopenLastFile,
    openTabs: settings.behavior.openTabs,
    activeTabPath: settings.behavior.activeTabPath,
    recentFiles: settings.behavior.recentFiles,
    autoReload: settings.behavior.autoReload,
    defaultEditorMode: settings.behavior.defaultEditorMode,
    onSettingsChange: updateSettings,
  });

  const filePath = activeFile?.path;
  const content = activeFile?.content ?? null;
  const activeMode = activeFile?.mode ?? "view";

  // For view/split, use file content; for edit, use editContent for preview
  const displayContent = activeMode !== "view" ? (activeFile?.editContent ?? content) : content;

  const tocEntries = useTableOfContents(displayContent);
  const backlinks = useMemo(
    () => (filePath ? filterBacklinks(wikilinkRefs, workspaceFiles, filePath) : []),
    [wikilinkRefs, workspaceFiles, filePath],
  );
  const [filesSidebarVisible, setFilesSidebarVisible] = useState(
    settings.layout.filesSidebarVisible,
  );
  const [outlineSidebarVisible, setOutlineSidebarVisible] = useState(
    settings.layout.outlineSidebarVisible,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Auto-save for edit mode (operates on the active tab's active file)
  useAutoSave({
    path: filePath,
    content: activeFile?.editContent ?? null,
    dirty: activeFile?.dirty ?? false,
    onSaved: useCallback(
      (savedContent: string) => {
        if (activeTabId) markSaved(activeTabId, savedContent);
      },
      [activeTabId, markSaved],
    ),
  });

  // TTS
  const tts = useTTS({ voice: settings.ai.ttsVoice, speed: settings.ai.ttsSpeed });

  // AI
  const ai = useAI(settings.ai);
  const aiConfigured = settings.ai.provider !== "none";

  // Print
  const printDoc = usePrint({ entries: tocEntries, settings: settings.print });

  // Sync sidebar visibility with settings (each panel independently)
  useEffect(() => {
    setFilesSidebarVisible(settings.layout.filesSidebarVisible);
  }, [settings.layout.filesSidebarVisible]);
  useEffect(() => {
    setOutlineSidebarVisible(settings.layout.outlineSidebarVisible);
  }, [settings.layout.outlineSidebarVisible]);

  const toggleFilesSidebar = useCallback(() => {
    setFilesSidebarVisible((v) => {
      updateSettings("layout.filesSidebarVisible", !v);
      return !v;
    });
  }, [updateSettings]);

  const toggleOutlineSidebar = useCallback(() => {
    setOutlineSidebarVisible((v) => {
      updateSettings("layout.outlineSidebarVisible", !v);
      return !v;
    });
  }, [updateSettings]);

  // AI action handler
  const handleAIAction = useCallback(
    (action: string, text: string) => {
      setAIPanelOpen(true);
      ai.run(action as AIAction, text);
    },
    [ai],
  );

  // Handle editor content changes
  const handleEditorChange = useCallback(
    (newContent: string) => {
      if (activeTabId) {
        updateEditContent(activeTabId, newContent);
      }
    },
    [activeTabId, updateEditContent],
  );

  // Wikilink navigation: only meaningful inside a folder tab; outside one,
  // we have no workspace to resolve against, so the call is dropped.
  // TODO: cross-file heading scroll — `heading` is plumbed through but not yet
  // applied after the target file finishes loading.
  const handleOpenWikilink = useCallback(
    (path: string, _heading?: string) => {
      if (activeTabId && activeTab?.kind === "folder") {
        openFileInFolderTab(activeTabId, path);
      }
    },
    [activeTabId, activeTab, openFileInFolderTab],
  );

  const { handleToggle: handleTaskToggle } = useTaskList({ activeTabId, toggleTask });

  // Close the active tab (used by File → Close Folder which doubles as close-tab
  // when the active tab is a folder; Cmd+W still closes the window).
  const closeActiveTab = useCallback(() => {
    if (activeTabId) closeTab(activeTabId);
  }, [activeTabId, closeTab]);

  // Menu events from Rust
  useEffect(() => {
    const unlistenOpen = listen("menu-open-file", () => {
      openFileDialog();
    });
    const unlistenOpenFolder = listen("menu-open-folder", () => {
      openFolder();
    });
    const unlistenCloseTab = listen("menu-close-tab", () => {
      closeActiveTab();
    });
    const unlistenFilesSidebar = listen("menu-toggle-files-sidebar", () => {
      toggleFilesSidebar();
    });
    const unlistenOutlineSidebar = listen("menu-toggle-outline-sidebar", () => {
      toggleOutlineSidebar();
    });
    const unlistenResetView = listen("menu-reset-view", () => {
      updateSettings("layout.filesSidebarVisible", true);
      updateSettings("layout.outlineSidebarVisible", true);
      updateSettings("layout.sidebarLayout", "beside");
      updateSettings("layout.swapSidebarSides", false);
    });
    const unlistenSettings = listen("menu-open-settings", () => {
      setSettingsOpen(true);
    });
    const unlistenAI = listen<string>("menu-ai-action", (event) => {
      const text = displayContent ?? "";
      if (text) handleAIAction(event.payload, text);
    });
    const unlistenFind = listen("menu-find", () => {
      setSearchOpen(true);
    });
    const unlistenToggleEdit = listen("menu-toggle-edit", () => {
      if (!activeTabId) return;
      const nextMode = activeMode === "view" ? "edit" : activeMode === "edit" ? "split" : "view";
      setTabMode(activeTabId, nextMode);
    });
    const unlistenPrint = listen("menu-print", () => {
      printDoc();
    });
    const unlistenReadAloud = listen("menu-ai-read-aloud", () => {
      if (tts.speaking) {
        tts.stop();
      } else if (displayContent) {
        tts.speak(displayContent);
      }
    });
    const unlistenZoomIn = listen("menu-zoom-in", () => {
      updateSettings(
        "appearance.fontSize",
        Math.min(settings.appearance.fontSize + ZOOM_STEP, ZOOM_MAX),
      );
    });
    const unlistenZoomOut = listen("menu-zoom-out", () => {
      updateSettings(
        "appearance.fontSize",
        Math.max(settings.appearance.fontSize - ZOOM_STEP, ZOOM_MIN),
      );
    });
    const unlistenZoomReset = listen("menu-zoom-reset", () => {
      updateSettings("appearance.fontSize", ZOOM_DEFAULT);
    });
    return () => {
      unlistenOpen.then((fn) => fn());
      unlistenOpenFolder.then((fn) => fn());
      unlistenCloseTab.then((fn) => fn());
      unlistenFilesSidebar.then((fn) => fn());
      unlistenOutlineSidebar.then((fn) => fn());
      unlistenResetView.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
      unlistenAI.then((fn) => fn());
      unlistenReadAloud.then((fn) => fn());
      unlistenZoomIn.then((fn) => fn());
      unlistenZoomOut.then((fn) => fn());
      unlistenZoomReset.then((fn) => fn());
      unlistenFind.then((fn) => fn());
      unlistenToggleEdit.then((fn) => fn());
      unlistenPrint.then((fn) => fn());
    };
  }, [
    openFileDialog,
    openFolder,
    closeActiveTab,
    toggleFilesSidebar,
    toggleOutlineSidebar,
    displayContent,
    handleAIAction,
    tts,
    settings.appearance.fontSize,
    updateSettings,
    activeTabId,
    activeMode,
    setTabMode,
    printDoc,
  ]);

  // Apply code theme via injected <style> element
  useEffect(() => {
    const themeCSS = CODE_THEMES[settings.appearance.codeTheme] ?? CODE_THEMES.glyph;
    let styleEl = document.getElementById("glyph-code-theme") as HTMLStyleElement | null;
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "glyph-code-theme";
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = themeCSS;
  }, [settings.appearance.codeTheme]);

  // Context menu (Win/Linux only) — uses files-sidebar toggle for the legacy 'toggleSidebar' slot
  const contextMenuActions = useMemo(
    () => ({
      openFileDialog,
      toggleSidebar: toggleFilesSidebar,
      ttsSpeak: tts.speak,
      ttsStop: tts.stop,
      ttsSpeaking: tts.speaking,
      ttsAvailable: tts.available,
      aiAction: handleAIAction,
      aiConfigured,
      content: displayContent,
    }),
    [openFileDialog, toggleFilesSidebar, tts, handleAIAction, aiConfigured, displayContent],
  );
  useContextMenu(platform, contextMenuActions);

  const sidebarWidth = settings.layout.sidebarWidth;

  const renderContent = () => {
    if (!activeTab) return null;
    const file = activeFileOf(activeTab);
    if (!file || !file.content) return null;

    const editorContent = file.editContent ?? file.content;

    const workspaceRoot = activeTab.kind === "folder" ? activeTab.root : undefined;

    if (file.mode === "edit") {
      return (
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor
            content={editorContent}
            onChange={handleEditorChange}
            workspaceFiles={workspaceFiles}
            workspaceRoot={workspaceRoot}
          />
        </div>
      );
    }

    if (file.mode === "split") {
      return (
        <div className="flex-1 overflow-hidden">
          <SplitView
            content={editorContent}
            filePath={file.path}
            onChange={handleEditorChange}
            searchOpen={searchOpen}
            onSearchClose={() => setSearchOpen(false)}
            workspaceFiles={workspaceFiles}
            workspaceRoot={workspaceRoot}
            onOpenWikilink={handleOpenWikilink}
            onTaskToggle={handleTaskToggle}
          />
        </div>
      );
    }

    return (
      <MarkdownViewer
        key={`${activeTab.id}:${file.path}`}
        content={file.content}
        filePath={file.path}
        initialScrollTop={file.scrollTop}
        onScrollChange={saveScrollPosition}
        searchOpen={searchOpen}
        onSearchClose={() => setSearchOpen(false)}
        workspaceFiles={workspaceFiles}
        onOpenWikilink={handleOpenWikilink}
        onTaskToggle={handleTaskToggle}
      />
    );
  };

  // Render the empty state when there's no active tab, or when a folder tab is
  // active without a file selected yet.
  const showEmptyState =
    !initializing && (!activeTab || (activeTab.kind === "folder" && !activeFile));
  const folderEmptyHint = activeTab?.kind === "folder" && !activeFile;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={setActiveTab}
        onClose={closeTab}
        onModeChange={setTabMode}
      />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          side="left"
          activeTab={activeTab}
          tocEntries={tocEntries}
          backlinks={backlinks}
          filesVisible={filesSidebarVisible}
          outlineVisible={outlineSidebarVisible}
          sidebarLayout={settings.layout.sidebarLayout}
          swapSidebarSides={settings.layout.swapSidebarSides}
          width={sidebarWidth}
          onToggleFiles={toggleFilesSidebar}
          onToggleOutline={toggleOutlineSidebar}
          onToggleExpand={toggleExpand}
          onOpenFileInTab={openFileInFolderTab}
          onOpenFileInNewTab={openFile}
        />
        {activeTab && activeFile && content ? (
          renderContent()
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
        <Sidebar
          side="right"
          activeTab={activeTab}
          tocEntries={tocEntries}
          backlinks={backlinks}
          filesVisible={filesSidebarVisible}
          outlineVisible={outlineSidebarVisible}
          sidebarLayout={settings.layout.sidebarLayout}
          swapSidebarSides={settings.layout.swapSidebarSides}
          width={sidebarWidth}
          onToggleFiles={toggleFilesSidebar}
          onToggleOutline={toggleOutlineSidebar}
          onToggleExpand={toggleExpand}
          onOpenFileInTab={openFileInFolderTab}
          onOpenFileInNewTab={openFile}
        />
      </div>
      <StatusBar filePath={filePath} content={displayContent} />

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AIPanel
        open={aiPanelOpen}
        onClose={() => {
          setAIPanelOpen(false);
          ai.clear();
        }}
        loading={ai.loading}
        result={ai.result}
        error={ai.error}
        action={ai.action}
        onReadAloud={tts.available ? tts.speak : undefined}
        speaking={tts.speaking}
        onStopReading={tts.stop}
      />
    </div>
  );
}
