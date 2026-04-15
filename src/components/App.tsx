import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type AIAction, useAI } from "../hooks/useAI";
import { useContextMenu } from "../hooks/useContextMenu";
import { useFileLoader } from "../hooks/useFileLoader";
import { useFileWatcher } from "../hooks/useFileWatcher";
import { usePlatform } from "../hooks/usePlatform";
import { useSettings } from "../hooks/useSettings";
import { useTableOfContents } from "../hooks/useTableOfContents";
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
import { EmptyState } from "./layout/EmptyState";
import { Sidebar } from "./layout/Sidebar";
import { StatusBar } from "./layout/StatusBar";
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

  const { content, metadata, initializing, loadFile, openFileDialog } = useFileLoader({
    reopenLastFile: settings.behavior.reopenLastFile,
    recentFiles: settings.behavior.recentFiles,
    onRecentFilesChange: useCallback(
      (files: string[]) => updateSettings("behavior.recentFiles", files),
      [updateSettings],
    ),
    autoReload: settings.behavior.autoReload,
  });

  const tocEntries = useTableOfContents(content);
  const [sidebarVisible, setSidebarVisible] = useState(settings.layout.sidebarVisible);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aiPanelOpen, setAIPanelOpen] = useState(false);

  // TTS
  const tts = useTTS({ voice: settings.ai.ttsVoice, speed: settings.ai.ttsSpeed });

  // AI
  const ai = useAI(settings.ai);
  const aiConfigured = settings.ai.provider !== "none";

  // Reload file on external change (respecting autoReload setting)
  useFileWatcher(
    useCallback(() => {
      if (metadata?.path && settings.behavior.autoReload) {
        loadFile(metadata.path);
      }
    }, [metadata?.path, loadFile, settings.behavior.autoReload]),
  );

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
      const text = content ?? "";
      if (text) handleAIAction(event.payload, text);
    });
    const unlistenReadAloud = listen("menu-ai-read-aloud", () => {
      if (tts.speaking) {
        tts.stop();
      } else if (content) {
        tts.speak(content);
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
    };
  }, [
    openFileDialog,
    toggleSidebar,
    content,
    handleAIAction,
    tts,
    settings.appearance.fontSize,
    updateSettings,
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
      content,
    }),
    [openFileDialog, toggleSidebar, tts, handleAIAction, aiConfigured, content],
  );
  useContextMenu(platform, contextMenuActions);

  const sidebarPosition = settings.layout.sidebarPosition;
  const sidebarWidth = settings.layout.sidebarWidth;

  const sidebarElement = content ? (
    <Sidebar entries={tocEntries} visible={sidebarVisible} width={sidebarWidth} />
  ) : null;

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <div className="flex flex-1 min-h-0">
        {sidebarPosition === "left" && sidebarElement}
        {content ? (
          <MarkdownViewer content={content} filePath={metadata?.path} />
        ) : !initializing ? (
          <div className="flex-1">
            <EmptyState platform={platform} onOpenFile={openFileDialog} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
        {sidebarPosition === "right" && sidebarElement}
      </div>
      <StatusBar filePath={metadata?.path} content={content} />

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
