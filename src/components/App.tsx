import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type AIAction, useAI } from "../hooks/useAI";
import { useAutoSave } from "../hooks/useAutoSave";
import { useContextMenu } from "../hooks/useContextMenu";
import { usePlatform } from "../hooks/usePlatform";
import { useSettings } from "../hooks/useSettings";
import { useTableOfContents } from "../hooks/useTableOfContents";
import { useTabs } from "../hooks/useTabs";
import { useTheme } from "../hooks/useTheme";
import { useTTS } from "../hooks/useTTS";
import { ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEP } from "../lib/settings";
// Code theme CSS (inline imports for production compatibility)
import glyphThemeCSS from "../styles/highlight.css?inline";
import githubThemeCSS from "../styles/highlight-github.css?inline";
import monokaiThemeCSS from "../styles/highlight-monokai.css?inline";
import nordThemeCSS from "../styles/highlight-nord.css?inline";
import solarizedDarkThemeCSS from "../styles/highlight-solarized-dark.css?inline";
import solarizedLightThemeCSS from "../styles/highlight-solarized-light.css?inline";
import { MarkdownEditor } from "./editor/MarkdownEditor";
import { SplitView } from "./editor/SplitView";
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
    initializing,
    closeTab,
    setActiveTab,
    setTabMode,
    updateEditContent,
    markSaved,
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

  const content = activeTab?.content ?? null;
  const filePath = activeTab?.path;
  const activeMode = activeTab?.mode ?? "view";

  // For view/split, use file content; for edit, use editContent for preview
  const displayContent = activeMode !== "view" ? (activeTab?.editContent ?? content) : content;

  const tocEntries = useTableOfContents(displayContent);
  const [sidebarVisible, setSidebarVisible] = useState(settings.layout.sidebarVisible);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPanelOpen, setAIPanelOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Auto-save for edit mode
  useAutoSave({
    path: filePath,
    content: activeTab?.editContent ?? null,
    dirty: activeTab?.dirty ?? false,
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

  // Sync sidebar visibility with settings
  useEffect(() => {
    setSidebarVisible(settings.layout.sidebarVisible);
  }, [settings.layout.sidebarVisible]);

  const toggleSidebar = useCallback(() => {
    setSidebarVisible((v) => {
      updateSettings("layout.sidebarVisible", !v);
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

  // Menu events from Rust
  useEffect(() => {
    const unlistenOpen = listen("menu-open-file", () => {
      openFileDialog();
    });
    const unlistenSidebar = listen("menu-toggle-sidebar", () => {
      toggleSidebar();
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
      unlistenSidebar.then((fn) => fn());
      unlistenSettings.then((fn) => fn());
      unlistenAI.then((fn) => fn());
      unlistenReadAloud.then((fn) => fn());
      unlistenZoomIn.then((fn) => fn());
      unlistenZoomOut.then((fn) => fn());
      unlistenZoomReset.then((fn) => fn());
      unlistenFind.then((fn) => fn());
      unlistenToggleEdit.then((fn) => fn());
    };
  }, [
    openFileDialog,
    toggleSidebar,
    displayContent,
    handleAIAction,
    tts,
    settings.appearance.fontSize,
    updateSettings,
    activeTabId,
    activeMode,
    setTabMode,
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

  // Context menu (Win/Linux only)
  const contextMenuActions = useMemo(
    () => ({
      openFileDialog,
      toggleSidebar,
      ttsSpeak: tts.speak,
      ttsStop: tts.stop,
      ttsSpeaking: tts.speaking,
      ttsAvailable: tts.available,
      aiAction: handleAIAction,
      aiConfigured,
      content: displayContent,
    }),
    [openFileDialog, toggleSidebar, tts, handleAIAction, aiConfigured, displayContent],
  );
  useContextMenu(platform, contextMenuActions);

  const sidebarPosition = settings.layout.sidebarPosition;
  const sidebarWidth = settings.layout.sidebarWidth;

  const sidebarElement = displayContent ? (
    <Sidebar entries={tocEntries} visible={sidebarVisible} width={sidebarWidth} />
  ) : null;

  const renderContent = () => {
    if (!activeTabId || !content) return null;

    const editorContent = activeTab?.editContent ?? content;

    if (activeMode === "edit") {
      return (
        <div className="flex-1 overflow-hidden">
          <MarkdownEditor content={editorContent} onChange={handleEditorChange} />
        </div>
      );
    }

    if (activeMode === "split") {
      return (
        <div className="flex-1 overflow-hidden">
          <SplitView
            content={editorContent}
            filePath={filePath}
            onChange={handleEditorChange}
            searchOpen={searchOpen}
            onSearchClose={() => setSearchOpen(false)}
          />
        </div>
      );
    }

    return (
      <MarkdownViewer
        key={activeTabId}
        content={content}
        filePath={filePath}
        initialScrollTop={activeTab?.scrollTop ?? 0}
        onScrollChange={saveScrollPosition}
        searchOpen={searchOpen}
        onSearchClose={() => setSearchOpen(false)}
      />
    );
  };

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
        {sidebarPosition === "left" && sidebarElement}
        {activeTabId && content ? (
          renderContent()
        ) : !initializing ? (
          <div className="flex-1">
            <EmptyState platform={platform} onOpenFile={openFileDialog} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {sidebarPosition === "right" && sidebarElement}
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
