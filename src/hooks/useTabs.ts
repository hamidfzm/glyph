import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";
import type { WikilinkRef } from "../lib/backlinks";
import { MARKDOWN_EXTENSIONS } from "../lib/markdownExtensions";
import type { EditorMode } from "../lib/settings";

interface FileMetadata {
  name: string;
  path: string;
  size: number;
  modified: number;
}

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  modified: number;
}

interface FileState {
  path: string;
  content: string | null;
  metadata: FileMetadata | null;
  scrollTop: number;
  mode: EditorMode;
  editContent: string | null;
  dirty: boolean;
}

export interface FileTab {
  id: string;
  kind: "file";
  file: FileState;
}

export interface FolderTab {
  id: string;
  kind: "folder";
  root: string;
  expanded: Set<string>;
  nodes: Map<string, DirEntry[]>;
  file: FileState | null;
}

export type Tab = FileTab | FolderTab;

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface PersistedTab {
  kind: "file" | "folder";
  path: string; // root for folder, file path for file
  filePath?: string; // current file inside a folder tab
  expanded?: string[]; // expanded subdirs for folder tab
}

const MAX_RECENT_FILES = 10;
const DIRECTORY_REFRESH_DEBOUNCE = 300;

let nextId = 0;
function generateId() {
  nextId++;
  return `tab-${nextId}`;
}

interface UseTabsOptions {
  reopenLastFile: boolean;
  openTabs: PersistedTab[] | string[]; // legacy: string[] = file-only persistence
  activeTabPath: string;
  recentFiles: string[];
  autoReload: boolean;
  defaultEditorMode: EditorMode;
  onSettingsChange: (key: string, value: unknown) => void;
}

async function loadFileContent(path: string) {
  const [content, metadata] = await Promise.all([
    invoke<string>("read_file", { path }),
    invoke<FileMetadata>("get_file_metadata", { path }),
  ]);
  return { content, metadata };
}

function makeFileState(path: string, mode: EditorMode): FileState {
  return {
    path,
    content: null,
    metadata: null,
    scrollTop: 0,
    mode,
    editContent: null,
    dirty: false,
  };
}

export function activeFileOf(tab: Tab | null | undefined): FileState | null {
  if (!tab) return null;
  return tab.file;
}

export function tabPathOf(tab: Tab): string {
  return tab.kind === "folder" ? tab.root : tab.file.path;
}

function isInWorkspace(filePath: string, root: string): boolean {
  if (filePath === root) return true;
  return filePath.startsWith(`${root}/`) || filePath.startsWith(`${root}\\`);
}

function normalizePersistedTabs(value: PersistedTab[] | string[]): PersistedTab[] {
  if (value.length === 0) return [];
  // Legacy: array of file paths
  if (typeof value[0] === "string") {
    return (value as string[]).map((path) => ({ kind: "file" as const, path }));
  }
  return value as PersistedTab[];
}

export function useTabs(options: UseTabsOptions) {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  const [initializing, setInitializing] = useState(true);
  // Recursive markdown index per folder tab; ephemeral (rebuilt on open / dir change).
  const [workspaceIndex, setWorkspaceIndex] = useState<Record<string, string[]>>({});
  // Outbound wikilink references per folder tab; used to compute backlinks.
  const [wikilinkIndex, setWikilinkIndex] = useState<Record<string, WikilinkRef[]>>({});
  const scrollRefsMap = useRef<Map<string, number>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const { tabs, activeTabId } = state;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);
  const workspaceFiles = activeTab?.kind === "folder" ? (workspaceIndex[activeTab.id] ?? []) : [];
  const wikilinkRefs = activeTab?.kind === "folder" ? (wikilinkIndex[activeTab.id] ?? []) : [];

  // Persist tabs to settings whenever state changes (post-init)
  useEffect(() => {
    if (initializing) return;
    const persisted: PersistedTab[] = tabs.map((tab) => {
      if (tab.kind === "folder") {
        return {
          kind: "folder",
          path: tab.root,
          filePath: tab.file?.path,
          expanded: Array.from(tab.expanded),
        };
      }
      return { kind: "file", path: tab.file.path };
    });
    optionsRef.current.onSettingsChange("behavior.openTabs", persisted);
    const activeTabPath = activeTab ? tabPathOf(activeTab) : "";
    optionsRef.current.onSettingsChange("behavior.activeTabPath", activeTabPath);
  }, [tabs, activeTab, initializing]);

  const addToRecent = useCallback((path: string) => {
    const current = optionsRef.current.recentFiles ?? [];
    const updated = [path, ...current.filter((f) => f !== path)].slice(0, MAX_RECENT_FILES);
    optionsRef.current.onSettingsChange("behavior.recentFiles", updated);
  }, []);

  const loadDirectory = useCallback(async (path: string): Promise<DirEntry[]> => {
    try {
      return await invoke<DirEntry[]>("read_directory", { path });
    } catch (err) {
      console.error(`Failed to read directory ${path}:`, err);
      return [];
    }
  }, []);

  const loadWorkspaceFiles = useCallback(async (root: string): Promise<string[]> => {
    try {
      return await invoke<string[]>("list_markdown_files", { path: root });
    } catch (err) {
      console.error(`Failed to list markdown files for ${root}:`, err);
      return [];
    }
  }, []);

  const loadWikilinkRefs = useCallback(async (root: string): Promise<WikilinkRef[]> => {
    try {
      return await invoke<WikilinkRef[]>("scan_wikilinks", { path: root });
    } catch (err) {
      console.error(`Failed to scan wikilinks for ${root}:`, err);
      return [];
    }
  }, []);

  // Open a file as a new top-level tab; if already open as a top-level tab, activate it.
  const openFile = useCallback(
    async (path: string) => {
      const existing = stateRef.current.tabs.find((t) => t.kind === "file" && t.file.path === path);
      if (existing) {
        setState((prev) => ({ ...prev, activeTabId: existing.id }));
        return;
      }

      const id = generateId();
      try {
        const { content, metadata } = await loadFileContent(path);
        await invoke("watch_file", { path });
        const mode = optionsRef.current.defaultEditorMode;
        const newTab: FileTab = {
          id,
          kind: "file",
          file: { ...makeFileState(path, mode), content, metadata },
        };
        setState((prev) => {
          if (prev.tabs.some((t) => t.kind === "file" && t.file.path === path)) {
            const match = prev.tabs.find((t) => t.kind === "file" && t.file.path === path)!;
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

  // Open a file inside a specific folder tab — replaces that tab's currently-viewed file.
  // Watches the new file, unwatches the old. Folder's directory watcher stays.
  const openFileInFolderTab = useCallback(
    async (tabId: string, path: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind !== "folder") return;

      const previousFilePath = tab.file?.path;
      if (previousFilePath === path) return;

      try {
        const { content, metadata } = await loadFileContent(path);
        if (previousFilePath) {
          invoke("unwatch_file", { path: previousFilePath }).catch(() => {});
        }
        await invoke("watch_file", { path });
        const mode = optionsRef.current.defaultEditorMode;
        const newFile: FileState = { ...makeFileState(path, mode), content, metadata };
        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((t) =>
            t.id === tabId && t.kind === "folder" ? { ...t, file: newFile } : t,
          ),
        }));
        addToRecent(path);
      } catch (err) {
        console.error("Failed to open file in folder tab:", err);
      }
    },
    [addToRecent],
  );

  // Open a new folder workspace as a top-level tab.
  // If a path is provided, opens that path; otherwise prompts via dialog.
  const openFolder = useCallback(
    async (root?: string, options?: { expanded?: string[]; filePath?: string }) => {
      let resolvedRoot = root;
      if (!resolvedRoot) {
        const selected = await open({ directory: true, multiple: false });
        if (typeof selected !== "string") return;
        resolvedRoot = selected;
      }

      // Activate existing folder tab for this root, don't duplicate.
      const existing = stateRef.current.tabs.find(
        (t) => t.kind === "folder" && t.root === resolvedRoot,
      );
      if (existing) {
        setState((prev) => ({ ...prev, activeTabId: existing.id }));
        return;
      }

      const id = generateId();
      try {
        await invoke("watch_directory", { path: resolvedRoot });
      } catch (err) {
        console.error("Failed to watch directory:", err);
      }

      const expanded = new Set<string>(options?.expanded ?? []);
      const nodes = new Map<string, DirEntry[]>();
      nodes.set(resolvedRoot, await loadDirectory(resolvedRoot));
      for (const dir of expanded) {
        nodes.set(dir, await loadDirectory(dir));
      }

      const newTab: FolderTab = {
        id,
        kind: "folder",
        root: resolvedRoot,
        expanded,
        nodes,
        file: null,
      };
      setState((prev) => ({ tabs: [...prev.tabs, newTab], activeTabId: id }));

      // Build the workspace markdown index in the background so wikilinks can resolve.
      loadWorkspaceFiles(resolvedRoot).then((files) => {
        setWorkspaceIndex((prev) => ({ ...prev, [id]: files }));
      });
      loadWikilinkRefs(resolvedRoot).then((refs) => {
        setWikilinkIndex((prev) => ({ ...prev, [id]: refs }));
      });

      if (options?.filePath) {
        // Defer so the new tab is in state for openFileInFolderTab to find
        await openFileInFolderTab(id, options.filePath);
      }
    },
    [loadDirectory, loadWikilinkRefs, loadWorkspaceFiles, openFileInFolderTab],
  );

  const toggleExpand = useCallback(
    async (tabId: string, path: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === tabId);
      if (!tab || tab.kind !== "folder") return;

      const wasExpanded = tab.expanded.has(path);
      const newExpanded = new Set(tab.expanded);
      if (wasExpanded) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }

      let newNodes = tab.nodes;
      if (!wasExpanded && !tab.nodes.has(path)) {
        const entries = await loadDirectory(path);
        newNodes = new Map(tab.nodes);
        newNodes.set(path, entries);
      }

      setState((prev) => ({
        ...prev,
        tabs: prev.tabs.map((t) =>
          t.id === tabId && t.kind === "folder"
            ? { ...t, expanded: newExpanded, nodes: newNodes }
            : t,
        ),
      }));
    },
    [loadDirectory],
  );

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      const idx = prev.tabs.findIndex((t) => t.id === id);
      if (idx === -1) return prev;

      const tab = prev.tabs[idx];
      if (tab.kind === "folder") {
        invoke("unwatch_directory", { path: tab.root }).catch(() => {});
        if (tab.file) invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
      } else {
        invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
      }
      scrollRefsMap.current.delete(id);
      setWorkspaceIndex((prevIdx) => {
        if (!(id in prevIdx)) return prevIdx;
        const next = { ...prevIdx };
        delete next[id];
        return next;
      });
      setWikilinkIndex((prevIdx) => {
        if (!(id in prevIdx)) return prevIdx;
        const next = { ...prevIdx };
        delete next[id];
        return next;
      });

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
      // Save scroll position of current active tab's file
      if (prev.activeTabId) {
        const savedScroll = scrollRefsMap.current.get(prev.activeTabId) ?? 0;
        return {
          tabs: prev.tabs.map((t) => {
            if (t.id !== prev.activeTabId) return t;
            const file = activeFileOf(t);
            if (!file) return t;
            const updatedFile = { ...file, scrollTop: savedScroll };
            return t.kind === "folder" ? { ...t, file: updatedFile } : { ...t, file: updatedFile };
          }),
          activeTabId: id,
        };
      }
      return { ...prev, activeTabId: id };
    });
  }, []);

  const updateActiveFile = useCallback((id: string, mutator: (f: FileState) => FileState) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.id !== id) return t;
        const file = activeFileOf(t);
        if (!file) return t;
        const next = mutator(file);
        return t.kind === "folder" ? { ...t, file: next } : { ...t, file: next };
      }),
    }));
  }, []);

  const setTabMode = useCallback(
    (id: string, mode: EditorMode) => {
      updateActiveFile(id, (f) => {
        // When entering edit mode, initialize editContent from content
        if (mode !== "view" && f.editContent === null) {
          return { ...f, mode, editContent: f.content };
        }
        return { ...f, mode };
      });
    },
    [updateActiveFile],
  );

  const updateEditContent = useCallback(
    (id: string, editContent: string) => {
      updateActiveFile(id, (f) => ({ ...f, editContent, dirty: true }));
    },
    [updateActiveFile],
  );

  const markSaved = useCallback(
    (id: string, content: string) => {
      updateActiveFile(id, (f) => ({ ...f, content, dirty: false }));
    },
    [updateActiveFile],
  );

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
          extensions: MARKDOWN_EXTENSIONS as string[],
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
          const persistedTabs = normalizePersistedTabs(options.openTabs);
          for (const persisted of persistedTabs) {
            if (persisted.kind === "folder") {
              await openFolder(persisted.path, {
                expanded: persisted.expanded ?? [],
                filePath: persisted.filePath,
              });
            } else {
              await openFile(persisted.path);
            }
          }
          // Activate the previously-active tab by its primary path
          if (options.activeTabPath) {
            setState((prev) => {
              const match = prev.tabs.find((t) => tabPathOf(t) === options.activeTabPath);
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

  // Listen for file-changed events (auto-reload). Applies to any open file —
  // top-level FileTabs and the active file inside FolderTabs alike.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unlisten = listen<string>("file-changed", (event) => {
      if (!optionsRef.current.autoReload) return;
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const changedPath = event.payload;
        const matchingTab = stateRef.current.tabs.find(
          (t) => activeFileOf(t)?.path === changedPath,
        );
        if (!matchingTab) return;
        const file = activeFileOf(matchingTab);
        if (!file) return;
        // Skip reload if the file is in edit mode with unsaved changes
        if (file.mode !== "view" && file.dirty) return;
        try {
          const { content, metadata } = await loadFileContent(changedPath);
          setState((prev) => ({
            ...prev,
            tabs: prev.tabs.map((t) => {
              const f = activeFileOf(t);
              if (!f || f.path !== changedPath) return t;
              const next: FileState = { ...f, content, metadata };
              return t.kind === "folder" ? { ...t, file: next } : { ...t, file: next };
            }),
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

  // Listen for directory-changed events: refresh the affected folder tab's tree.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unlisten = listen<string>("directory-changed", (event) => {
      const watchedRoot = event.payload;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const tab = stateRef.current.tabs.find(
          (t) => t.kind === "folder" && t.root === watchedRoot,
        );
        if (!tab || tab.kind !== "folder") return;
        // Refresh root + every currently-loaded subdirectory under this root.
        const dirsToRefresh: string[] = [tab.root];
        for (const dir of tab.nodes.keys()) {
          if (dir !== tab.root && isInWorkspace(dir, tab.root)) {
            dirsToRefresh.push(dir);
          }
        }
        const [fresh, freshFiles, freshRefs] = await Promise.all([
          Promise.all(dirsToRefresh.map(async (d) => [d, await loadDirectory(d)] as const)),
          loadWorkspaceFiles(tab.root),
          loadWikilinkRefs(tab.root),
        ]);
        setState((prev) => ({
          ...prev,
          tabs: prev.tabs.map((t) => {
            if (t.id !== tab.id || t.kind !== "folder") return t;
            const newNodes = new Map(t.nodes);
            for (const [d, entries] of fresh) {
              newNodes.set(d, entries);
            }
            return { ...t, nodes: newNodes };
          }),
        }));
        setWorkspaceIndex((prev) => ({ ...prev, [tab.id]: freshFiles }));
        setWikilinkIndex((prev) => ({ ...prev, [tab.id]: freshRefs }));
      }, DIRECTORY_REFRESH_DEBOUNCE);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unlisten.then((fn) => fn());
    };
  }, [loadDirectory, loadWikilinkRefs, loadWorkspaceFiles]);

  return {
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
    saveScrollPosition,
    openFileDialog,
  };
}
