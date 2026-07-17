import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceNotice } from "@/hooks/useWorkspaceNotice";
import type { WikilinkRef } from "@/lib/backlinks";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { adaptD2Content, D2_EXTENSIONS, isD2File } from "@/lib/d2Extensions";
import { emptyHistory, popRedo, popUndo, pushEntry, type TabHistory } from "@/lib/editHistory";
import { isImageFile } from "@/lib/imageExtensions";
import { isMarkdownFile, MARKDOWN_EXTENSIONS } from "@/lib/markdownExtensions";
import { adaptMmdContent } from "@/lib/mmd";
import { isNotebookFile, isSupportedFile, NOTEBOOK_EXTENSIONS } from "@/lib/notebookExtensions";
import { basename, isPathInside, parentDir, pruneInside } from "@/lib/paths";
import { pickFiles, pickFolder } from "@/lib/pickers";
import { isMobilePlatform } from "@/lib/platform";
import { EDITOR_MODE, type EditorMode } from "@/lib/settings";
import { toggleTaskAtLine } from "@/lib/taskList";
import { subscribe } from "@/lib/tauriEvent";
import { injectedOpen, isPrimaryWindow } from "@/lib/windowContext";
import {
  getWorkspaceLastFile,
  resolveWorkspace,
  setWorkspaceLastFile,
  type WorkspaceResolution,
} from "@/lib/workspace";
import {
  COMPLETE_INDEX_STATUS,
  COMPLETE_SCAN,
  type FileScan,
  indexIncompleteKey,
  sameScanStatus,
  truncatedScan,
  type WikilinkScan,
  type WorkspaceIndexStatus,
} from "@/lib/workspaceScan";

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
  /** Monotonic edit counter. Every edit bumps it; a save records the revision
   *  it wrote, and clears `dirty` only if the revision is still current. This
   *  stops an in-flight write from marking a newer edit clean. */
  revision: number;
}

export interface FileTab {
  id: string;
  kind: "file";
  file: FileState;
}

export interface GraphTab {
  id: string;
  kind: "graph";
  /** Workspace root this graph visualizes (always the window's workspace). */
  root: string;
  /** Graph tabs never display a document. Present so `activeFileOf` stays a
   *  plain field read across all tab kinds. */
  file: null;
}

export type Tab = FileTab | GraphTab;

/**
 * The window's folder workspace. One per window (VS Code model): the sidebar
 * tree, wikilink index, backlinks, and graph all hang off this, while the tab
 * strip holds plain document tabs — workspace notes and loose external files
 * alike. Opening another folder replaces it.
 */
export interface Workspace {
  root: string;
  expanded: Set<string>;
  nodes: Map<string, DirEntry[]>;
}

interface TabsState {
  tabs: Tab[];
  activeTabId: string | null;
}

interface PersistedTab {
  kind: "file" | "folder" | "graph";
  path: string; // workspace root for folder/graph entries, file path for file
  filePath?: string; // legacy: the single file once shown inside a folder tab
  expanded?: string[]; // expanded subdirs (folder entry only)
}

const MAX_RECENT_FILES = 10;
const DIRECTORY_REFRESH_DEBOUNCE = 300;
// Safety bound on the "expand all" walk so a pathological tree can't spin forever.
const EXPAND_ALL_MAX_DIRS = 5000;

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
  // Called to surface a workspace notice (see #262): a refusal (a folder nested
  // inside another Glyph workspace) or a `persistent` warning (a folder opened
  // despite sitting inside a parent git repo). The provider surfaces it as a
  // banner.
  onWorkspaceNotice: (notice: WorkspaceNotice, options?: { persistent?: boolean }) => void;
}

async function loadFileContent(path: string): Promise<{
  content: string;
  metadata: FileMetadata | null;
}> {
  // Mobile pickers hand back sandboxed URIs (content:// on Android) that the
  // Rust fs commands cannot open; only the fs plugin's native layer can, and
  // metadata (and therefore file watching) doesn't apply to them.
  const [raw, metadata] = isMobilePlatform()
    ? [await readTextFile(path), null]
    : await Promise.all([
        invoke<string>("read_file", { path }),
        invoke<FileMetadata>("get_file_metadata", { path }),
      ]);
  // `.mmd` files double as Mermaid diagram source; `.d2` files are D2 diagram
  // source. Each adapter fence-wraps its own extension so the existing markdown
  // renderer turns the body into a diagram, and is a no-op for other paths.
  const content = adaptD2Content(path, adaptMmdContent(path, raw));
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
    revision: 0,
  };
}

export function activeFileOf(tab: Tab | null | undefined): FileState | null {
  if (!tab) return null;
  return tab.file;
}

export function tabPathOf(tab: Tab): string {
  return tab.kind === "file" ? tab.file.path : tab.root;
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

/** Remove `ids` from the tab strip, moving the active tab to a neighbour when
 *  the current one is among the removed. */
function removeTabs(prev: TabsState, ids: ReadonlySet<string>): TabsState {
  if (ids.size === 0) return prev;
  const activeIdx = prev.tabs.findIndex((t) => t.id === prev.activeTabId);
  const updated = prev.tabs.filter((t) => !ids.has(t.id));
  let newActiveId = prev.activeTabId;
  if (newActiveId !== null && ids.has(newActiveId)) {
    const fallback = updated[Math.min(Math.max(activeIdx, 0), updated.length - 1)] ?? null;
    newActiveId = fallback?.id ?? null;
  }
  return { tabs: updated, activeTabId: newActiveId };
}

export function useTabs(options: UseTabsOptions) {
  const { t } = useTranslation("workspace");
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: null });
  const [initializing, setInitializing] = useState(true);
  // The window's single folder workspace (or null when only loose files are
  // open). Tree state lives here; document tabs live in `state`.
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // Recursive markdown index + outbound wikilink refs of the workspace;
  // ephemeral (rebuilt on open / dir change).
  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [wikilinkRefs, setWikilinkRefs] = useState<WikilinkRef[]>([]);
  const [indexStatus, setIndexStatus] = useState<WorkspaceIndexStatus>(COMPLETE_INDEX_STATUS);
  const scrollRefsMap = useRef<Map<string, number>>(new Map());
  const stateRef = useRef(state);
  stateRef.current = state;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // The single close coordinator. Defined up here so every destructive
  // lifecycle path (tab close, workspace close/replace, window close) flushes
  // through it. It reaches saveDocument via a ref because that lives further
  // down; the ref is reassigned each render below.
  const saveDocumentRef = useRef<(id: string) => Promise<boolean>>(() => Promise.resolve(true));

  const flushForClose = useCallback(
    async (ids?: Iterable<string>): Promise<boolean> => {
      const scope = ids ? new Set(ids) : null;
      const dirty = stateRef.current.tabs.filter(
        (tab): tab is FileTab =>
          tab.kind === "file" && tab.file.dirty && (!scope || scope.has(tab.id)),
      );
      if (dirty.length === 0) return true;

      // Flush every dirty document and wait for the writes to settle. Each save
      // reports its own success, so a failed write can't be missed by a
      // dirty-flag read that hasn't re-rendered yet.
      const saved = await Promise.all(dirty.map((tab) => saveDocumentRef.current(tab.id)));
      const unsaved = dirty.filter((_, i) => !saved[i]);
      if (unsaved.length === 0) return true;

      // Some documents couldn't be saved; closing now would drop those edits,
      // so confirm an explicit discard.
      const files = unsaved.map((tab) => `• ${basename(tab.file.path)}`).join("\n");
      return ask(t("unsavedChanges.message", { files }), {
        title: t("unsavedChanges.title"),
        kind: "warning",
        okLabel: t("unsavedChanges.discard"),
        cancelLabel: t("unsavedChanges.cancel"),
      });
    },
    [t],
  );

  const { tabs, activeTabId } = state;
  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null;
  const activeFile = activeFileOf(activeTab);

  // Persist workspace + tabs to settings whenever state changes (post-init).
  // The workspace travels as a leading "folder" entry in the same list the
  // old multi-folder model used, so stale sessions migrate without a new key.
  useEffect(() => {
    // Secondary windows are ephemeral: only the primary window owns session
    // restore, so it alone persists the open-tabs list (#295 multi-window).
    if (initializing || !isPrimaryWindow()) return;
    const persisted: PersistedTab[] = [];
    if (workspace) {
      persisted.push({
        kind: "folder",
        path: workspace.root,
        expanded: Array.from(workspace.expanded),
      });
    }
    for (const tab of tabs) {
      persisted.push(
        tab.kind === "graph"
          ? { kind: "graph", path: tab.root }
          : { kind: "file", path: tab.file.path },
      );
    }
    optionsRef.current.onSettingsChange("behavior.openTabs", persisted);
    const activeTabPath = activeTab ? tabPathOf(activeTab) : "";
    optionsRef.current.onSettingsChange("behavior.activeTabPath", activeTabPath);
  }, [tabs, activeTab, workspace, initializing]);

  // Report this window's workspace to the Rust window registry so open-folder
  // routing knows which folder each window shows (focus vs new window).
  useEffect(() => {
    invoke("set_window_workspace", { root: workspace?.root ?? null }).catch(() => {});
  }, [workspace?.root]);

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

  const loadWorkspaceFiles = useCallback(async (root: string): Promise<FileScan> => {
    try {
      return await invoke<FileScan>("list_markdown_files", { path: root });
    } catch (err) {
      console.error(`Failed to list markdown files for ${root}:`, err);
      return { files: [], status: COMPLETE_SCAN };
    }
  }, []);

  const loadWikilinkRefs = useCallback(async (root: string): Promise<WikilinkScan> => {
    try {
      return await invoke<WikilinkScan>("scan_wikilinks", { path: root });
    } catch (err) {
      console.error(`Failed to scan wikilinks for ${root}:`, err);
      return { refs: [], status: COMPLETE_SCAN };
    }
  }, []);

  // Merge new scan statuses, keeping the previous object identity while the
  // values are unchanged so the incomplete-index banner effect below doesn't
  // refire on every directory refresh.
  const updateIndexStatus = useCallback((part: Partial<WorkspaceIndexStatus>) => {
    setIndexStatus((prev) => {
      const next = { ...prev, ...part };
      const unchanged =
        sameScanStatus(next.files, prev.files) && sameScanStatus(next.wikilinks, prev.wikilinks);
      return unchanged ? prev : next;
    });
  }, []);

  // Surface a persistent banner when a workspace index is incomplete (#436).
  // The user can dismiss it; the sidebar keeps its own indicator. Keyed on the
  // workspace root plus the effective reason + limit: a dismissed banner
  // re-shows only when the surfaced truncation actually changes (a rescan or
  // the second index reporting the same one refires nothing), while switching
  // workspaces notifies afresh even for an identical truncation.
  const truncation = truncatedScan(indexStatus);
  const truncationReason = truncation?.reason ?? null;
  const truncationLimit = truncation?.limit ?? null;
  const workspaceRoot = workspace?.root ?? null;
  useEffect(() => {
    if (!truncationReason || !workspaceRoot) return;
    optionsRef.current.onWorkspaceNotice(
      {
        key: indexIncompleteKey(truncationReason),
        values: { limit: String(truncationLimit ?? 0) },
      },
      { persistent: true },
    );
  }, [workspaceRoot, truncationReason, truncationLimit]);

  // Open a file as a document tab; if it's already open, activate its tab.
  const openFile = useCallback(
    async (path: string) => {
      // Defensive gate: never load an unsupported file. Glyph rendering treats
      // content as markdown (HTML included via the sanitizer), so opening a
      // random `.txt` / `.html` / etc. is a code-injection vector. Notebooks
      // (`.ipynb`) are allowed — they take the dedicated NotebookViewer path.
      // Images/SVGs are allowed too — they render in the read-only image
      // viewer, never as text. See memory/reject-unsupported-file-types.md.
      if (!isSupportedFile(path) && !isImageFile(path)) {
        console.warn(`Refusing to open unsupported file: ${path}`);
        return;
      }
      const existing = stateRef.current.tabs.find((t) => t.kind === "file" && t.file.path === path);
      if (existing) {
        setState((prev) => ({ ...prev, activeTabId: existing.id }));
        return;
      }

      const id = generateId();
      try {
        // Images are binary: never read them as text. Load metadata only and
        // let the image viewer render straight from the asset protocol. (No
        // file watch — the asset URL is static, so an on-disk change would not
        // refresh it anyway.) Documents load their text and start a watch.
        const isImage = isImageFile(path);
        let content: string | null;
        let metadata: FileMetadata | null;
        if (isImage) {
          content = null;
          // Same sandboxed-URI caveat as loadFileContent.
          metadata = isMobilePlatform()
            ? null
            : await invoke<FileMetadata>("get_file_metadata", { path });
        } else {
          ({ content, metadata } = await loadFileContent(path));
          // metadata is null exactly for mobile picker URIs, unwatchable too.
          if (metadata) {
            await invoke("watch_file", { path });
          }
        }
        // Notebooks, canvases, images, and D2 files are read-only; open straight
        // into the viewer regardless of the user's default editor mode. (`.d2`
        // content is fence-wrapped for rendering, so an editor would write the
        // wrapper back over the source.)
        const mode =
          isImage || isNotebookFile(path) || isCanvasFile(path) || isD2File(path)
            ? EDITOR_MODE.view
            : optionsRef.current.defaultEditorMode;
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
        // Remember workspace notes in `.glyph/state.json` (git-ignored) so the
        // workspace re-opens onto them next time. Fire-and-forget: a failure
        // here is never fatal to opening the file.
        const root = workspaceRef.current?.root;
        if (root && isInWorkspace(path, root)) {
          setWorkspaceLastFile(root, path).catch(() => {});
        }
      } catch (err) {
        console.error("Failed to open file:", err);
      }
    },
    [addToRecent],
  );

  // Close every tab that belongs to the workspace at `root`: file tabs inside
  // it plus graph tabs (they render its index). Loose external files survive.
  const closeWorkspaceTabs = useCallback((root: string) => {
    setState((prev) => {
      const removedIds = new Set<string>();
      for (const t of prev.tabs) {
        if (t.kind === "graph") {
          removedIds.add(t.id);
        } else if (isInWorkspace(t.file.path, root)) {
          invoke("unwatch_file", { path: t.file.path }).catch(() => {});
          removedIds.add(t.id);
        }
      }
      for (const removedId of removedIds) {
        scrollRefsMap.current.delete(removedId);
        editHistory.current.delete(removedId);
      }
      return removeTabs(prev, removedIds);
    });
  }, []);

  // Close the window's workspace: stop watching it, close its tabs, drop the
  // tree + indexes. Loose file tabs stay open.
  const closeWorkspace = useCallback(async () => {
    const ws = workspaceRef.current;
    if (!ws) return;
    // Protect every dirty document in the workspace before tearing it down.
    const ids = stateRef.current.tabs
      .filter((t) => t.kind === "file" && isInWorkspace(t.file.path, ws.root))
      .map((t) => t.id);
    if (!(await flushForClose(ids))) return;
    invoke("unwatch_directory", { path: ws.root }).catch(() => {});
    closeWorkspaceTabs(ws.root);
    workspaceRef.current = null;
    setWorkspace(null);
    setWorkspaceFiles([]);
    setWikilinkRefs([]);
    setIndexStatus(COMPLETE_INDEX_STATUS);
  }, [closeWorkspaceTabs, flushForClose]);

  // Guards concurrent openFolder calls for the same root (StrictMode double
  // mount, rapid re-invocation) so the folder is only watched/loaded once.
  const folderOpenInFlight = useRef<string | null>(null);

  // Open a folder as this window's workspace. With an explicit `root` (CLI,
  // session restore, a spawned window's injected open, or an `open-folder`
  // event) the folder is adopted into this window. With no root (the user's
  // Open Folder dialog) the choice is routed through the window manager so a
  // different folder opens a new window instead of replacing this one.
  const openFolder = useCallback(
    async (
      root?: string,
      openOptions?: { expanded?: string[]; silent?: boolean; autoLoad?: boolean },
    ) => {
      const resolvedRoot = root;
      if (!resolvedRoot) {
        const selected = await pickFolder();
        if (typeof selected !== "string") return;
        // No explicit root means a user "Open Folder" action: route it through
        // the window manager. A folder already open elsewhere focuses that
        // window; an empty current window adopts it (Rust emits `open-folder`
        // back to us); a different folder in an occupied window opens a new
        // window. This is what stops a second folder silently replacing the
        // current workspace.
        await invoke("request_open", { kind: "folder", path: selected });
        return;
      }
      if (
        workspaceRef.current?.root === resolvedRoot ||
        folderOpenInFlight.current === resolvedRoot
      ) {
        return;
      }

      // A workspace is one git repo's top level (#262). Refuse a folder nested
      // inside another Glyph workspace's `.glyph/` so workspace-wide features
      // have an unambiguous owner. A folder merely sitting inside a parent git
      // repo is still allowed (so `samples/` inside this repo opens) but earns a
      // persistent warning. Switching to a folder that overlaps the open one
      // just replaces the workspace, so there's nothing to refuse there. The
      // `silent` path (persisted-tab restore) skips the banner.
      const notify = (notice: WorkspaceNotice, persistent = false) => {
        if (openOptions?.silent) return;
        if (persistent) optionsRef.current.onWorkspaceNotice(notice, { persistent: true });
        else optionsRef.current.onWorkspaceNotice(notice);
      };
      let resolution: WorkspaceResolution;
      try {
        resolution = await resolveWorkspace(resolvedRoot);
      } catch (err) {
        notify({ key: "error.couldntOpen", values: { error: String(err) } });
        return;
      }
      if (resolution.glyphConflict) {
        notify({ key: "notice.nestedWorkspace", values: { path: resolution.glyphConflict } });
        return;
      }
      // Allowed, but a folder inside a parent git repo means workspace-wide
      // features (Sync, `.glyph/` config) resolve against that repo, so warn and
      // keep the notice up until the user dismisses it.
      if (resolution.nestedUnder) {
        notify({ key: "notice.nestedUnderGit", values: { path: resolution.nestedUnder } }, true);
      }

      folderOpenInFlight.current = resolvedRoot;
      try {
        // One workspace per window: switching folders replaces the current
        // one and closes its tabs (loose external files stay). Flush the
        // outgoing workspace's dirty tabs first; a cancelled discard aborts the
        // switch and keeps the current workspace open.
        const previous = workspaceRef.current;
        if (previous) {
          const ids = stateRef.current.tabs
            .filter((t) => t.kind === "file" && isInWorkspace(t.file.path, previous.root))
            .map((t) => t.id);
          if (!(await flushForClose(ids))) return;
          invoke("unwatch_directory", { path: previous.root }).catch(() => {});
          closeWorkspaceTabs(previous.root);
          // Drop the outgoing workspace's scan state so the incoming one's
          // truncation (even an identical one) notifies afresh.
          setIndexStatus(COMPLETE_INDEX_STATUS);
        }

        try {
          await invoke("watch_directory", { path: resolvedRoot });
        } catch (err) {
          console.error("Failed to watch directory:", err);
        }

        const expanded = new Set<string>(openOptions?.expanded ?? []);
        const nodes = new Map<string, DirEntry[]>();
        nodes.set(resolvedRoot, await loadDirectory(resolvedRoot));
        for (const dir of expanded) {
          nodes.set(dir, await loadDirectory(dir));
        }
        const ws: Workspace = { root: resolvedRoot, expanded, nodes };
        workspaceRef.current = ws;
        setWorkspace(ws);

        // Build the workspace markdown index so wikilinks can resolve.
        const { files, status } = await loadWorkspaceFiles(resolvedRoot);
        setWorkspaceFiles(files);
        updateIndexStatus({ files: status });
        loadWikilinkRefs(resolvedRoot).then((scan) => {
          // A replacement may have started meanwhile; don't clobber its refs.
          if (workspaceRef.current?.root === resolvedRoot) {
            setWikilinkRefs(scan.refs);
            updateIndexStatus({ wikilinks: scan.status });
          }
        });

        // Auto-open the workspace's remembered file (or its first note) as a
        // document tab. Restore passes autoLoad: false because the persisted
        // tab list re-opens explicit tabs itself.
        if (openOptions?.autoLoad !== false && files.length > 0) {
          const remembered = await getWorkspaceLastFile(resolvedRoot).catch(() => null);
          const target = remembered && files.includes(remembered) ? remembered : files[0];
          if (isMarkdownFile(target)) {
            await openFile(target);
          }
        }
      } finally {
        folderOpenInFlight.current = null;
      }
    },
    [
      closeWorkspaceTabs,
      flushForClose,
      loadDirectory,
      loadWikilinkRefs,
      loadWorkspaceFiles,
      openFile,
      updateIndexStatus,
    ],
  );

  // Open (or re-activate) the graph view of the workspace. The optional root
  // must match the open workspace (used by persisted-tab restore); without a
  // workspace the call is a no-op (the menu item is disabled in that state).
  const openGraph = useCallback((root?: string) => {
    const wsRoot = workspaceRef.current?.root;
    if (!wsRoot || (root !== undefined && root !== wsRoot)) return;
    const id = generateId();
    setState((prev) => {
      const existing = prev.tabs.find((t) => t.kind === "graph");
      if (existing) return { ...prev, activeTabId: existing.id };
      const newTab: GraphTab = { id, kind: "graph", root: wsRoot, file: null };
      return { tabs: [...prev.tabs, newTab], activeTabId: id };
    });
  }, []);

  const toggleExpand = useCallback(
    async (path: string) => {
      const ws = workspaceRef.current;
      if (!ws) return;

      const wasExpanded = ws.expanded.has(path);
      const newExpanded = new Set(ws.expanded);
      if (wasExpanded) {
        newExpanded.delete(path);
      } else {
        newExpanded.add(path);
      }

      let newNodes = ws.nodes;
      if (!wasExpanded && !ws.nodes.has(path)) {
        const entries = await loadDirectory(path);
        newNodes = new Map(ws.nodes);
        newNodes.set(path, entries);
      }

      setWorkspace((prev) => (prev ? { ...prev, expanded: newExpanded, nodes: newNodes } : prev));
    },
    [loadDirectory],
  );

  // Create a note/canvas/folder inside `dir`, then expand `dir` and refresh
  // its listing so the new entry shows immediately (rather than waiting on
  // the directory watcher's debounce). Returns the created path, or null.
  const createEntry = useCallback(
    async (dir: string, kind: "note" | "canvas" | "folder"): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const command =
          kind === "note" ? "create_note" : kind === "canvas" ? "create_canvas" : "create_folder";
        const newPath = await invoke<string>(command, { dir, root: ws.root });
        const entries = await loadDirectory(dir);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(dir, entries);
          const expanded = new Set(prev.expanded);
          if (dir !== prev.root) expanded.add(dir);
          return { ...prev, nodes, expanded };
        });
        return newPath;
      } catch (err) {
        console.error(`Failed to create ${kind}:`, err);
        return null;
      }
    },
    [loadDirectory],
  );

  const createNote = useCallback((dir: string) => createEntry(dir, "note"), [createEntry]);
  const createCanvas = useCallback((dir: string) => createEntry(dir, "canvas"), [createEntry]);
  const createFolder = useCallback((dir: string) => createEntry(dir, "folder"), [createEntry]);

  // Re-point every open file tab under `oldPath` to its location under
  // `newPath`, moving the file watchers along. Used by rename and move.
  const repointOpenFiles = useCallback((oldPath: string, newPath: string) => {
    for (const t of stateRef.current.tabs) {
      if (t.kind !== "file" || !isPathInside(t.file.path, oldPath)) continue;
      const moved = newPath + t.file.path.slice(oldPath.length);
      invoke("unwatch_file", { path: t.file.path }).catch(() => {});
      invoke("watch_file", { path: moved }).catch(() => {});
    }
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => {
        if (t.kind !== "file" || !isPathInside(t.file.path, oldPath)) return t;
        const moved = newPath + t.file.path.slice(oldPath.length);
        return { ...t, file: { ...t.file, path: moved } };
      }),
    }));
  }, []);

  // Rename a freshly-created entry (inline rename). Refreshes the parent
  // listing so the new name shows. Returns the final (collision-safe) path.
  const renamePath = useCallback(
    async (path: string, newName: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const finalPath = await invoke<string>("rename_path", { path, newName, root: ws.root });
        const parent = parentDir(path, ws.root);
        const entries = await loadDirectory(parent);
        repointOpenFiles(path, finalPath);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(parent, entries);
          return { ...prev, nodes };
        });
        return finalPath;
      } catch (err) {
        console.error("Failed to rename:", err);
        return null;
      }
    },
    [loadDirectory, repointOpenFiles],
  );

  // Duplicate a note/folder next to itself, then refresh the parent listing.
  const duplicatePath = useCallback(
    async (path: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const newPath = await invoke<string>("duplicate_path", { path, root: ws.root });
        const parent = parentDir(path, ws.root);
        const entries = await loadDirectory(parent);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(parent, entries);
          return { ...prev, nodes };
        });
        return newPath;
      } catch (err) {
        console.error("Failed to duplicate:", err);
        return null;
      }
    },
    [loadDirectory],
  );

  // Move a note/folder into `toDir`. Refreshes both the source and
  // destination listings, prunes cached child listings under the old
  // location, and re-points open tabs (and their watchers) if they moved.
  const movePath = useCallback(
    async (from: string, toDir: string): Promise<string | null> => {
      const ws = workspaceRef.current;
      if (!ws) return null;
      try {
        const newPath = await invoke<string>("move_path", { from, toDir, root: ws.root });
        if (newPath === from) return newPath;
        const sourceParent = parentDir(from, ws.root);
        const [sourceEntries, destEntries] = await Promise.all([
          loadDirectory(sourceParent),
          loadDirectory(toDir),
        ]);
        repointOpenFiles(from, newPath);
        setWorkspace((prev) => {
          if (!prev) return prev;
          const nodes = new Map(prev.nodes);
          nodes.set(sourceParent, sourceEntries);
          nodes.set(toDir, destEntries);
          // Drop cached listings for the moved entry and anything under it.
          pruneInside(nodes.keys(), from, (key) => nodes.delete(key));
          return { ...prev, nodes };
        });
        return newPath;
      } catch (err) {
        console.error("Failed to move:", err);
        return null;
      }
    },
    [loadDirectory, repointOpenFiles],
  );

  // Collapse every expanded directory in the workspace tree.
  const collapseAll = useCallback(() => {
    setWorkspace((prev) => (prev ? { ...prev, expanded: new Set<string>() } : prev));
  }, []);

  // Expand every directory in the workspace, loading any not-yet-read
  // listings. Bounded so a pathological tree can't spin forever.
  const expandAll = useCallback(
    async (limit: number = EXPAND_ALL_MAX_DIRS) => {
      const ws = workspaceRef.current;
      if (!ws) return;
      const nodes = new Map(ws.nodes);
      const expanded = new Set<string>();
      const queue: string[] = [ws.root];
      let visited = 0;
      while (queue.length > 0 && visited < limit) {
        const dir = queue.shift() as string;
        visited += 1;
        let entries = nodes.get(dir);
        if (!entries) {
          entries = await loadDirectory(dir);
          nodes.set(dir, entries);
        }
        for (const entry of entries) {
          if (entry.isDirectory) {
            expanded.add(entry.path);
            queue.push(entry.path);
          }
        }
      }
      setWorkspace((prev) => (prev ? { ...prev, nodes, expanded } : prev));
    },
    [loadDirectory],
  );

  // Delete a note/folder after confirming. Closes any open tabs under the
  // deleted path and prunes the tree's cached listings.
  const deletePath = useCallback(
    async (path: string): Promise<boolean> => {
      const ws = workspaceRef.current;
      if (!ws) return false;
      const name = path.split(/[\\/]/).filter(Boolean).pop() ?? path;
      const confirmed = await ask(t("confirmDelete.message", { name }), {
        title: t("confirmDelete.title"),
        kind: "warning",
      });
      if (!confirmed) return false;
      try {
        await invoke("delete_path", { path, root: ws.root });
      } catch (err) {
        console.error("Failed to delete:", err);
        return false;
      }

      const parent = parentDir(path, ws.root);
      const entries = await loadDirectory(parent);
      setState((prev) => {
        const removedIds = new Set<string>();
        for (const t of prev.tabs) {
          if (t.kind === "file" && isPathInside(t.file.path, path)) {
            invoke("unwatch_file", { path: t.file.path }).catch(() => {});
            scrollRefsMap.current.delete(t.id);
            editHistory.current.delete(t.id);
            removedIds.add(t.id);
          }
        }
        return removeTabs(prev, removedIds);
      });
      setWorkspace((prev) => {
        if (!prev) return prev;
        const nodes = new Map(prev.nodes);
        nodes.set(parent, entries);
        pruneInside(nodes.keys(), path, (key) => nodes.delete(key));
        const expanded = new Set(prev.expanded);
        pruneInside(expanded, path, (key) => expanded.delete(key));
        return { ...prev, nodes, expanded };
      });
      return true;
    },
    [loadDirectory, t],
  );

  const closeTab = useCallback(
    async (id: string) => {
      // Flush (and confirm on failure) before discarding the tab's state.
      if (!(await flushForClose([id]))) return;
      setState((prev) => {
        const tab = prev.tabs.find((t) => t.id === id);
        if (!tab) return prev;
        if (tab.kind === "file") {
          invoke("unwatch_file", { path: tab.file.path }).catch(() => {});
        }
        scrollRefsMap.current.delete(id);
        editHistory.current.delete(id);
        return removeTabs(prev, new Set([id]));
      });
    },
    [flushForClose],
  );

  // Reorder the tab strip: move tab `id` to `toIndex` (clamped to the strip).
  // Only the array order changes; the active tab and every tab's state are
  // untouched, and persistence follows from the persist effect above reading
  // the array order.
  const moveTab = useCallback((id: string, toIndex: number) => {
    setState((prev) => {
      const from = prev.tabs.findIndex((t) => t.id === id);
      if (from === -1) return prev;
      const to = Math.max(0, Math.min(toIndex, prev.tabs.length - 1));
      if (to === from) return prev;
      const tabs = [...prev.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(to, 0, moved);
      return { ...prev, tabs };
    });
  }, []);

  // Move the active tab by `delta` positions (-1 left, +1 right); a no-op at
  // either end of the strip or with no active tab.
  const moveActiveTab = useCallback(
    (delta: number) => {
      const { tabs, activeTabId } = stateRef.current;
      if (!activeTabId) return;
      const from = tabs.findIndex((t) => t.id === activeTabId);
      /* v8 ignore start -- defensive: a non-null activeTabId always references an open tab */
      if (from === -1) return;
      /* v8 ignore stop */
      moveTab(activeTabId, from + delta);
    },
    [moveTab],
  );

  const setActiveTab = useCallback((id: string) => {
    setState((prev) => {
      // Save scroll position of current active tab's file
      if (prev.activeTabId) {
        const savedScroll = scrollRefsMap.current.get(prev.activeTabId) ?? 0;
        return {
          tabs: prev.tabs.map((t) => {
            if (t.id !== prev.activeTabId || t.kind === "graph") return t;
            return { ...t, file: { ...t.file, scrollTop: savedScroll } };
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
        if (t.id !== id || t.kind === "graph") return t;
        return { ...t, file: mutator(t.file) };
      }),
    }));
  }, []);

  const setTabMode = useCallback(
    (id: string, mode: EditorMode) => {
      updateActiveFile(id, (f) => {
        // When entering edit mode, initialize editContent from content
        if (mode !== EDITOR_MODE.view && f.editContent === null) {
          return { ...f, mode, editContent: f.content };
        }
        return { ...f, mode };
      });
    },
    [updateActiveFile],
  );

  const updateEditContent = useCallback(
    (id: string, editContent: string) => {
      updateActiveFile(id, (f) => ({
        ...f,
        editContent,
        dirty: true,
        revision: f.revision + 1,
      }));
    },
    [updateActiveFile],
  );

  // Track when each path was last written by our own auto-save so the
  // file-changed event from that write doesn't re-enter as an external reload
  // (which would re-dispatch the document into the editor and dismiss any
  // open autocomplete popup).
  const selfSaveTimes = useRef<Map<string, number>>(new Map());
  const SELF_SAVE_GRACE_MS = 1500;

  // Per-tab undo/redo stack for programmatic edits (task toggles, future
  // rename refactors). The editor's own history covers typed input.
  const editHistory = useRef<Map<string, TabHistory>>(new Map());

  // Per-path write queue: serializes saves for the same file so two writes
  // can't complete out of order (the newer edit must land last on disk).
  const writeChains = useRef<Map<string, Promise<unknown>>>(new Map());

  // Persist one dirty editable tab. Safe to call for any tab id: skips graph,
  // clean, and still-loading tabs. The write is serialized per path, and the
  // dirty flag is cleared only when the written revision is still current, so a
  // slow write completing after a newer edit never strands that edit. Resolves
  // true when the document is safely on disk (or there was nothing to save),
  // false when the write failed — the close coordinator reads this directly
  // rather than re-checking dirty state, which may not have re-rendered yet.
  const saveDocument = useCallback(
    (id: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (tab?.kind !== "file") return Promise.resolve(true);
      const file = tab.file;
      if (!file.dirty) return Promise.resolve(true);
      // editContent is the edit buffer, always set once a tab is dirty; the null
      // check only narrows the type for the write below ("" stays valid, since a
      // fully-deleted document must still save, see #432).
      /* v8 ignore start -- unreachable: a dirty tab always has an edit buffer */
      if (file.editContent == null) return Promise.resolve(true);
      /* v8 ignore stop */
      const { path, editContent: content, revision } = file;

      const prev = writeChains.current.get(path) ?? Promise.resolve();
      const run = prev.then(async (): Promise<boolean> => {
        try {
          await invoke("write_file", { path, content });
          selfSaveTimes.current.set(path, Date.now());
          updateActiveFile(id, (f) => ({
            ...f,
            content,
            // Stay dirty when a newer edit landed while this write was in
            // flight, so the newer revision is saved on its own timer.
            dirty: f.revision !== revision,
          }));
          return true;
        } catch (err) {
          console.error("Auto-save failed:", err);
          // Leave the tab dirty (it retries on the next edit or shutdown flush)
          // and surface a visible, actionable notice instead of failing silently.
          optionsRef.current.onWorkspaceNotice(
            { key: "notice.saveFailed", values: { name: basename(path) } },
            { persistent: true },
          );
          return false;
        }
      });
      // Keep the chain intact even if this write threw, so ordering holds.
      writeChains.current.set(
        path,
        run.catch(() => {}),
      );
      return run;
    },
    [updateActiveFile],
  );
  // Let the close coordinator (defined above) flush through this saveDocument.
  saveDocumentRef.current = saveDocument;

  // Apply a programmatic edit. In view mode writes straight to disk (with the
  // self-save grace so the file-watcher doesn't re-enter); in edit/split mode
  // it updates editContent so auto-save flushes it. Used by toggleTask and the
  // undo/redo applier.
  const applyProgrammaticEdit = useCallback(
    async (id: string, next: string): Promise<boolean> => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab) return false;
      const file = activeFileOf(tab);
      if (!file) return false;

      if (file.mode !== EDITOR_MODE.view) {
        updateActiveFile(id, (f) => ({
          ...f,
          editContent: next,
          dirty: true,
          revision: f.revision + 1,
        }));
        return true;
      }

      try {
        await invoke("write_file", { path: file.path, content: next });
        selfSaveTimes.current.set(file.path, Date.now());
        // A leftover editContent from an earlier edit-mode session would
        // shadow the fresh content for consumers that render
        // `editContent ?? content` (the canvas viewer), so keep it in sync.
        updateActiveFile(id, (f) => ({
          ...f,
          content: next,
          ...(f.editContent != null ? { editContent: next } : {}),
        }));
        return true;
      } catch (err) {
        console.error("Failed to apply edit:", err);
        return false;
      }
    },
    [updateActiveFile],
  );

  // Toggle a checklist item by source line number. Pushes the change onto the
  // tab's history stack so it can be undone.
  const toggleTask = useCallback(
    async (id: string, line: number) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab) return;
      const file = activeFileOf(tab);
      if (!file?.content) return;

      const isEditing = file.mode !== EDITOR_MODE.view;
      const source = isEditing ? (file.editContent ?? file.content) : file.content;
      const next = toggleTaskAtLine(source, line);
      if (next === source) return;

      const applied = await applyProgrammaticEdit(id, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before: source, after: next }));
      }
    },
    [applyProgrammaticEdit],
  );

  // Commit a finished document edit produced by a non-text editor (e.g. the
  // canvas board): apply it and push one undo entry, exactly like toggleTask.
  // `next` is the full new content; a no-op (unchanged content) is ignored.
  const commitEdit = useCallback(
    async (id: string, next: string) => {
      const tab = stateRef.current.tabs.find((t) => t.id === id);
      if (!tab) return;
      const file = activeFileOf(tab);
      if (!file) return;
      /* v8 ignore start -- defensive: every open file has content loaded, so the null fallback is unreachable */
      const disk = file.content ?? "";
      /* v8 ignore stop */
      const before = file.mode !== EDITOR_MODE.view ? (file.editContent ?? disk) : disk;
      if (next === before) return;
      const applied = await applyProgrammaticEdit(id, next);
      if (applied) {
        const current = editHistory.current.get(id) ?? emptyHistory();
        editHistory.current.set(id, pushEntry(current, { before, after: next }));
      }
    },
    [applyProgrammaticEdit],
  );

  const undoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popUndo(history);
      if (!result) return;
      const applied = await applyProgrammaticEdit(id, result.entry.before);
      if (applied) editHistory.current.set(id, result.next);
    },
    [applyProgrammaticEdit],
  );

  const redoEdit = useCallback(
    async (id: string) => {
      const history = editHistory.current.get(id);
      if (!history) return;
      const result = popRedo(history);
      if (!result) return;
      const applied = await applyProgrammaticEdit(id, result.entry.after);
      if (applied) editHistory.current.set(id, result.next);
    },
    [applyProgrammaticEdit],
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
    const selected = await pickFiles([
      {
        name: t("common:fileDialog.documents"),
        extensions: [...MARKDOWN_EXTENSIONS, ...NOTEBOOK_EXTENSIONS, ...D2_EXTENSIONS] as string[],
      },
      {
        name: t("common:fileDialog.markdown"),
        extensions: MARKDOWN_EXTENSIONS as string[],
      },
      {
        name: t("common:fileDialog.notebook"),
        extensions: NOTEBOOK_EXTENSIONS as string[],
      },
      {
        name: t("common:fileDialog.d2"),
        extensions: D2_EXTENSIONS as string[],
      },
    ]);
    if (selected) {
      for (const path of selected) {
        await openFile(path);
      }
    }
  }, [openFile, t]);

  // Initialize: load CLI arg, restore workspace + tabs, or reopen last file
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    (async () => {
      try {
        // A spawned secondary window was created to open one specific path.
        // Adopt it and skip the CLI / session-restore path entirely (those
        // belong to the primary window).
        const injected = injectedOpen();
        if (injected) {
          if (injected.kind === "folder") await openFolder(injected.path);
          else await openFile(injected.path);
          setInitializing(false);
          return;
        }
        const initialFolder = await invoke<string | null>("get_initial_folder");
        if (initialFolder) {
          await openFolder(initialFolder);
          setInitializing(false);
          return;
        }
        const initialPath = await invoke<string | null>("get_initial_file");
        if (initialPath) {
          await openFile(initialPath);
        } else if (options.openTabs.length > 0) {
          const persistedTabs = normalizePersistedTabs(options.openTabs);
          // One workspace per window: the first folder entry wins. Extra
          // folder entries (legacy multi-workspace sessions) are skipped.
          const folderEntry = persistedTabs.find((t) => t.kind === "folder");
          if (folderEntry) {
            // Silent: if the folder became nested between sessions, skip it
            // rather than banner the user on every launch. autoLoad off — the
            // explicit tab list below decides what opens.
            await openFolder(folderEntry.path, {
              expanded: folderEntry.expanded ?? [],
              silent: true,
              autoLoad: false,
            });
            // Legacy folder tabs carried their single open file inline.
            if (folderEntry.filePath) {
              await openFile(folderEntry.filePath);
            }
          }
          for (const persisted of persistedTabs) {
            if (persisted.kind === "file") {
              await openFile(persisted.path);
            } else if (persisted.kind === "graph") {
              // No-op unless the workspace restored above matches.
              openGraph(persisted.path);
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

  // Listen for open-file and open-folder events (drag-drop, file associations)
  useEffect(() => {
    const unsubscribeFile = subscribe<string>("open-file", (event) => {
      openFile(event.payload);
    });
    const unsubscribeFolder = subscribe<string>("open-folder", (event) => {
      openFolder(event.payload);
    });
    return () => {
      unsubscribeFile();
      unsubscribeFolder();
    };
  }, [openFile, openFolder]);

  // Listen for file-changed events (auto-reload). Applies to any open file tab.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    const unsubscribe = subscribe<string>("file-changed", (event) => {
      if (!optionsRef.current.autoReload) return;
      clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const changedPath = event.payload;
        // Images are never watched and never read as text; ignore defensively.
        if (isImageFile(changedPath)) return;
        const matchingTab = stateRef.current.tabs.find(
          (t) => activeFileOf(t)?.path === changedPath,
        );
        if (!matchingTab) return;
        const file = activeFileOf(matchingTab);
        if (!file) return;
        // Skip reload if the file is in edit mode with unsaved changes
        if (file.mode !== EDITOR_MODE.view && file.dirty) return;
        // Skip if this file-changed was triggered by our own auto-save —
        // re-syncing identical content into the editor would dismiss any
        // active autocomplete popup mid-completion.
        const lastSelfSave = selfSaveTimes.current.get(changedPath);
        if (lastSelfSave && Date.now() - lastSelfSave < SELF_SAVE_GRACE_MS) return;
        try {
          const { content, metadata } = await loadFileContent(changedPath);
          setState((prev) => ({
            ...prev,
            tabs: prev.tabs.map((t) => {
              if (t.kind === "graph" || t.file.path !== changedPath) return t;
              // External reload invalidates our edit history — replaying old
              // diffs against changed content is unsafe.
              editHistory.current.delete(t.id);
              return { ...t, file: { ...t.file, content, metadata } };
            }),
          }));
        } catch {
          // ignore reload errors
        }
      }, 300);
    });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  // Listen for directory-changed events: refresh the workspace tree + indexes.
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribe<string>("directory-changed", (event) => {
      const watchedRoot = event.payload;
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(async () => {
        const ws = workspaceRef.current;
        if (!ws || ws.root !== watchedRoot) return;
        // Refresh root + every currently-loaded subdirectory under this root.
        const dirsToRefresh: string[] = [ws.root];
        for (const dir of ws.nodes.keys()) {
          if (dir !== ws.root && isInWorkspace(dir, ws.root)) {
            dirsToRefresh.push(dir);
          }
        }
        const [fresh, freshFiles, freshRefs] = await Promise.all([
          Promise.all(dirsToRefresh.map(async (d) => [d, await loadDirectory(d)] as const)),
          loadWorkspaceFiles(ws.root),
          loadWikilinkRefs(ws.root),
        ]);
        setWorkspace((prev) => {
          if (!prev || prev.root !== watchedRoot) return prev;
          const newNodes = new Map(prev.nodes);
          for (const [d, entries] of fresh) {
            newNodes.set(d, entries);
          }
          return { ...prev, nodes: newNodes };
        });
        setWorkspaceFiles(freshFiles.files);
        setWikilinkRefs(freshRefs.refs);
        updateIndexStatus({ files: freshFiles.status, wikilinks: freshRefs.status });
      }, DIRECTORY_REFRESH_DEBOUNCE);
    });
    return () => {
      if (timeout) clearTimeout(timeout);
      unsubscribe();
    };
  }, [loadDirectory, loadWikilinkRefs, loadWorkspaceFiles, updateIndexStatus]);

  return {
    tabs,
    activeTab,
    activeTabId,
    activeFile,
    initializing,
    workspace,
    workspaceFiles,
    wikilinkRefs,
    indexStatus,
    openFile,
    openFolder,
    openGraph,
    closeWorkspace,
    toggleExpand,
    createNote,
    createCanvas,
    createFolder,
    commitEdit,
    renamePath,
    duplicatePath,
    movePath,
    collapseAll,
    expandAll,
    deletePath,
    closeTab,
    flushForClose,
    setActiveTab,
    moveTab,
    moveActiveTab,
    setTabMode,
    updateEditContent,
    saveDocument,
    toggleTask,
    undoEdit,
    redoEdit,
    saveScrollPosition,
    openFileDialog,
  };
}
