import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

interface FileMetadata {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface Tab {
  id: string;
  path: string;
  content: string | null;
  metadata: FileMetadata | null;
  scrollTop: number;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

const MAX_RECENT_FILES = 10;

let nextId = 0;
function generateId() {
  nextId++;
  return `tab-${nextId}`;
}

interface UseTabsOptions {
  reopenLastFile: boolean;
  openTabs: string[];
  activeTabPath: string;
  recentFiles: string[];
  autoReload: boolean;
  onSettingsChange: (key: string, value: unknown) => void;
}

async function loadFileContent(path: string) {
  const [content, metadata] = await Promise.all([
    invoke<string>("read_file", { path }),
    invoke<FileMetadata>("get_file_metadata", { path }),
  ]);
  return { content, metadata };
}

export function useTabs(options: UseTabsOptions) {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  const [initializing, setInitializing] = useState(true);
  const scrollRefsMap = useRef<Map<string, number>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { tabs, activeTabId } = state;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;

  // Persist tabs to settings whenever state changes
  useEffect(() => {
    if (initializing) return;
    const paths = tabs.map((t) => t.path);
    const activePath = tabs.find((t) => t.id === activeTabId)?.path ?? "";
    optionsRef.current.onSettingsChange("behavior.openTabs", paths);
    optionsRef.current.onSettingsChange("behavior.activeTabPath", activePath);
  }, [tabs, activeTabId, initializing]);

  const addToRecent = useCallback((path: string) => {
    const current = optionsRef.current.recentFiles ?? [];
    const updated = [path, ...current.filter((f) => f !== path)].slice(0, MAX_RECENT_FILES);
    optionsRef.current.onSettingsChange("behavior.recentFiles", updated);
  }, []);

  const openFile = useCallback(
    async (path: string) => {
      // Check for duplicate via ref (avoids stale closure)
      const existing = stateRef.current.tabs.find((t) => t.path === path);
      if (existing) {
        setState((prev) => ({ ...prev, activeTabId: existing.id }));
        return;
      }

      const id = generateId();
      try {
        const { content, metadata } = await loadFileContent(path);
        await invoke("watch_file", { path });
        const newTab: Tab = { id, path, content, metadata, scrollTop: 0 };
        setState((prev) => {
          // Double-check inside updater
          if (prev.tabs.some((t) => t.path === path)) {
            const match = prev.tabs.find((t) => t.path === path)!;
            return { ...prev, activeTabId: match.id };
          }
          return { tabs: [...prev.tabs, newTab], activeTabId: id };
        });
        addToRecent(path);
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [addToRecent],
  );

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;

      const tab = prev.tabs[idx];
      invoke("unwatch_file", { path: tab.path }).catch(() => {});
      scrollRefsMap.current.delete(id);

      const updated = prev.tabs.filter((t) => t.id !== id);
      let newActiveId = prev.activeTabId;
      if (prev.activeTabId === id) {
        const newActive = updated[Math.min(idx, updated.length - 1)] ?? null;
        newActiveId = newActive?.id ?? null;
      }
      return { tabs: updated, activeTabId: newActiveId };
    });
  }, []);

  const setActiveTab = useCallback((id: string) => {
    setState((prev) => {
      // Save scroll position of current tab
      if (prev.activeTabId) {
        const savedScroll = scrollRefsMap.current.get(prev.activeTabId) ?? 0;
        return {
          tabs: prev.tabs.map((t) =>
            t.id === prev.activeTabId ? { ...t, scrollTop: savedScroll } : t,
          ),
          activeTabId: id,
        };
      }
      return { ...prev, activeTabId: id };
    });
  }, []);

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      if (activeTabId) {
        scrollRefsMap.current.set(activeTabId, scrollTop);
      }
    },
    [activeTabId],
  );

  const openFileDialog = useCallback(async () => {
    const selected = await open({
      multiple: true,
      filters: [
        {
          name: "Markdown",
          extensions: ["md", "markdown", "mdown", "mkd", "mkdn"],
        },
      ],
    });
    if (selected) {
      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        await openFile(path);
      }
    }
  }, [openFile]);

  // Initialize: load CLI arg, restore tabs, or reopen last file
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    (async () => {
      try {
        const initialPath = await invoke<string | null>("get_initial_file");
        if (initialPath) {
          await openFile(initialPath);
        } else if (options.openTabs.length > 0) {
          for (const path of options.openTabs) {
            await openFile(path);
          }
          // Activate the previously active tab
          if (options.activeTabPath) {
            setState((prev) => {
              const match = prev.tabs.find((t) => t.path === options.activeTabPath);
              return match ? { ...prev, activeTabId: match.id } : prev;
            });
          }
        } else if (options.reopenLastFile && options.recentFiles[0]) {
          await openFile(options.recentFiles[0]);
        }
      } catch {
        // ignore
      }
      setInitializing(false);
    })();
  }, []);

  // Listen for open-file events (drag-drop, file associations)
  useEffect(() => {
    const unlisten = listen<string>("open-file", (event) => {
      openFile(event.payload);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [openFile]);

  // Listen for file-changed events (auto-reload)
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unlisten = listen<string>("file-changed", (event) => {
      if (!optionsRef.current.autoReload) return;
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const changedPath = event.payload;
        try {
          const { content, metadata } = await loadFileContent(changedPath);
          setState((prev) => ({
            ...prev,
            tabs: prev.tabs.map((t) => (t.path === changedPath ? { ...t, content, metadata } : t)),
          }));
        } catch {
          // ignore reload errors
        }
      }, 300);
    });

    return () => {
      clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, []);

  return {
    tabs,
    activeTab,
    activeTabId,
    initializing,
    openFile,
    closeTab,
    setActiveTab,
    saveScrollPosition,
    openFileDialog,
  };
}
