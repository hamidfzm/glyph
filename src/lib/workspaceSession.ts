import { load, type Store } from "@tauri-apps/plugin-store";

// Per-workspace session snapshots (#226), stored in a dedicated machine-local
// store file, one key per workspace root path. Deliberately NOT in the
// workspace's `.glyph/` folder: Glyph never materializes `.glyph/` into a
// folder just because the user opened it (#458), and scroll/zoom/sidebar are
// per-machine ergonomics anyway.

/** One restorable tab: a document inside the workspace, or its graph view. */
export interface WorkspaceSessionTab {
  kind: "file" | "graph";
  /** Absolute file path; the workspace root for graph entries. */
  path: string;
}

export interface SidebarVisibility {
  filesSidebarVisible: boolean;
  outlineSidebarVisible: boolean;
}

/** Everything a workspace restores when it is reopened. */
export interface WorkspaceSession {
  tabs: WorkspaceSessionTab[];
  activeTabPath: string;
  expanded: string[];
  /** Per-tab scroll position, keyed by file path. */
  scroll: Record<string, number>;
  /** Per-tab zoom multiplier, keyed by file path. */
  zoom: Record<string, number>;
  /** Absent when no layout bridge was mounted at capture time. */
  sidebar?: SidebarVisibility;
  /** Write timestamp, used to prune the least recently saved workspaces. */
  savedAt: number;
}

const STORE_FILE = "workspace-sessions.json";
const SAVE_DEBOUNCE = 500;
/** Entries beyond the most recently saved N workspaces are pruned on write. */
export const MAX_WORKSPACE_SESSIONS = 50;

// The store plugin shares one instance per file across windows, so two windows
// writing their own workspace keys never clobber each other's entries.
let storePromise: Promise<Store | null> | null = null;
const pending = new Map<string, WorkspaceSession>();
// Roots whose stored entry could not be read this session: never write over an
// entry we could not read (a failed read is not an empty session, INV-2).
const readFailed = new Set<string>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let writeChain: Promise<void> = Promise.resolve();
// Depth counter (opens can nest through close flushes) suppressing the
// reactive snapshot persist while a restore or teardown churns the tab strip,
// so a half-restored strip is never written over a workspace's snapshot.
let restoreDepth = 0;

function sessionStore(): Promise<Store | null> {
  if (!storePromise) {
    storePromise = load(STORE_FILE, { defaults: {}, autoSave: false }).catch((err) => {
      console.error("Failed to load workspace sessions:", err);
      return null;
    });
  }
  return storePromise;
}

// A snapshot from disk may be partial (older build, interrupted write); fill
// missing fields with empties and drop malformed tab entries rather than
// throwing mid-restore (INV-7); the file is also user-editable, so entries
// are untrusted (INV-5).
function isSessionTab(entry: unknown): entry is WorkspaceSessionTab {
  const tab = entry as Partial<WorkspaceSessionTab> | null;
  return (
    typeof tab === "object" &&
    tab !== null &&
    (tab.kind === "file" || tab.kind === "graph") &&
    typeof tab.path === "string"
  );
}

function normalizeSession(
  value: Partial<WorkspaceSession> | null | undefined,
): WorkspaceSession | null {
  if (typeof value !== "object" || value === null || !Array.isArray(value.tabs)) return null;
  return {
    tabs: value.tabs.filter(isSessionTab),
    activeTabPath: typeof value.activeTabPath === "string" ? value.activeTabPath : "",
    expanded: Array.isArray(value.expanded) ? value.expanded : [],
    scroll: value.scroll ?? {},
    zoom: value.zoom ?? {},
    ...(value.sidebar ? { sidebar: value.sidebar } : {}),
    savedAt: value.savedAt ?? 0,
  };
}

/** The stored snapshot for `root`, or null when none exists (a missing entry
 *  is "never seen", not "empty"; an empty snapshot has `tabs: []`). Reads a
 *  queued-but-unflushed write first so rapid switches see their own data. */
export async function getWorkspaceSession(root: string): Promise<WorkspaceSession | null> {
  const queued = pending.get(root);
  if (queued) return queued;
  const store = await sessionStore();
  if (!store) return null;
  try {
    const value = await store.get<Partial<WorkspaceSession>>(root);
    return normalizeSession(value);
  } catch (err) {
    console.error("Failed to read the workspace session:", err);
    readFailed.add(root);
    return null;
  }
}

async function writePending(): Promise<void> {
  const store = await sessionStore();
  const entries = [...pending.entries()];
  pending.clear();
  if (!store || entries.length === 0) return;
  try {
    await Promise.all(entries.map(([root, session]) => store.set(root, session)));
    await pruneOldest(store);
    await store.save();
  } catch (err) {
    console.error("Failed to save workspace sessions:", err);
  }
}

async function pruneOldest(store: Store): Promise<void> {
  if ((await store.length()) <= MAX_WORKSPACE_SESSIONS) return;
  const all = await store.entries<WorkspaceSession>();
  const oldestFirst = all.sort(([, a], [, b]) => (a?.savedAt ?? 0) - (b?.savedAt ?? 0));
  for (const [root] of oldestFirst.slice(0, all.length - MAX_WORKSPACE_SESSIONS)) {
    await store.delete(root);
  }
}

function queueWrite(): Promise<void> {
  const next = writeChain.then(writePending);
  writeChain = next;
  return next;
}

/** Queue `session` as the snapshot for `root` (debounced, latest wins). */
export function saveWorkspaceSession(root: string, session: WorkspaceSession): void {
  if (readFailed.has(root)) return;
  pending.set(root, session);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void queueWrite();
  }, SAVE_DEBOUNCE);
}

/** Write every queued snapshot now; called before the window is allowed to
 *  close so the last capture is not lost to the debounce (INV-4). */
export function flushWorkspaceSessions(): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  return queueWrite();
}

export function beginSessionRestore(): void {
  restoreDepth += 1;
}

export function endSessionRestore(): void {
  restoreDepth = Math.max(0, restoreDepth - 1);
}

/** Whether a workspace open/close is currently churning the tab strip. */
export function isSessionRestoring(): boolean {
  return restoreDepth > 0;
}

/** Drop all module state (queued writes, the cached store, the restore flag).
 *  Test seam: suites sharing this module reset it between tests. */
export function resetWorkspaceSessions(): void {
  pending.clear();
  readFailed.clear();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  storePromise = null;
  writeChain = Promise.resolve();
  restoreDepth = 0;
}
