import { useState, useEffect, useCallback } from "react";
import { listen } from "@tauri-apps/api/event";
import { usePlatform } from "../hooks/usePlatform";
import { useTheme } from "../hooks/useTheme";
import { useFileLoader } from "../hooks/useFileLoader";
import { useFileWatcher } from "../hooks/useFileWatcher";
import { useTableOfContents } from "../hooks/useTableOfContents";
import { Sidebar } from "./Sidebar";
import { MarkdownViewer } from "./MarkdownViewer";
import { EmptyState } from "./EmptyState";
import { StatusBar } from "./StatusBar";

export function App() {
  const platform = usePlatform();
  useTheme();

  const { content, metadata, initializing, loadFile, openFileDialog } = useFileLoader();
  const tocEntries = useTableOfContents(content);
  const [sidebarVisible, setSidebarVisible] = useState(true);

  // Reload file on external change
  useFileWatcher(
    useCallback(() => {
      if (metadata?.path) {
        loadFile(metadata.path);
      }
    }, [metadata?.path, loadFile]),
  );

  // Menu events from Rust
  useEffect(() => {
    const unlistenOpen = listen("menu-open-file", () => {
      openFileDialog();
    });
    const unlistenSidebar = listen("menu-toggle-sidebar", () => {
      setSidebarVisible((v) => !v);
    });
    return () => {
      unlistenOpen.then((fn) => fn());
      unlistenSidebar.then((fn) => fn());
    };
  }, [openFileDialog]);

  return (
    <div className="flex flex-col h-full bg-[var(--color-surface)]">
      <div className="flex flex-1 min-h-0">
        {content && (
          <Sidebar
            entries={tocEntries}
            visible={sidebarVisible}
          />
        )}
        {content ? (
          <MarkdownViewer content={content} />
        ) : !initializing ? (
          <div className="flex-1">
            <EmptyState platform={platform} onOpenFile={openFileDialog} />
          </div>
        ) : (
          <div className="flex-1" />
        )}
      </div>
      <StatusBar filePath={metadata?.path} content={content} />
    </div>
  );
}
