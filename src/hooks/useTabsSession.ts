import { invoke } from "@tauri-apps/api/core";
import { type RefObject, useEffect, useRef, useState } from "react";
import type { OpenFolderOptions } from "@/hooks/useWorkspaceLifecycle";
import { isCliExportProcess } from "@/lib/cliExport";
import { isPathInside } from "@/lib/paths";
import {
  normalizePersistedTabs,
  type PersistedTab,
  type Tab,
  tabPathOf,
  type Workspace,
} from "@/lib/tabs";
import { injectedOpen, isPrimaryWindow } from "@/lib/windowContext";
import { getWorkspaceSession, saveWorkspaceSession } from "@/lib/workspaceSession";
import { buildSessionFromLegacy } from "@/lib/workspaceSessionSnapshot";

/** The slice of `useTabs` options this hook reads. */
interface TabsSessionOptions {
  reopenLastFile: boolean;
  openTabs: PersistedTab[] | string[]; // legacy: string[] = file-only persistence
  activeTabPath: string;
  recentFiles: string[];
  onSettingsChange: (key: string, value: unknown) => void;
}

interface UseTabsSessionParams {
  optionsRef: RefObject<TabsSessionOptions>;
  tabs: Tab[];
  activeTab: Tab | null;
  workspace: Workspace | null;
  workspaceRef: RefObject<Workspace | null>;
  openFile: (path: string) => Promise<unknown>;
  openFolder: (root?: string, options?: OpenFolderOptions) => Promise<void>;
  activateTabByPath: (path: string) => void;
}

/**
 * Session restore and persistence for the tab strip: what reopens on launch
 * (CLI argument, injected open for a spawned window, or the stored session) and
 * what gets written back to settings as tabs change. The global key holds only
 * the workspace pointer and loose external files; everything inside the
 * workspace lives in its per-workspace snapshot (#226), restored by
 * `openFolder` itself.
 */
export function useTabsSession({
  optionsRef,
  tabs,
  activeTab,
  workspace,
  workspaceRef,
  openFile,
  openFolder,
  activateTabByPath,
}: UseTabsSessionParams): { initializing: boolean } {
  const [initializing, setInitializing] = useState(true);
  // Guards the mount-only init effect against StrictMode's double invoke.
  const didInit = useRef(false);

  // Persist the workspace pointer + loose tabs to settings as state changes
  // (post-init). The workspace travels as a leading "folder" entry in the same
  // list the old multi-folder model used, so stale sessions migrate without a
  // new key.
  useEffect(() => {
    // Secondary windows are ephemeral: only the primary window owns session
    // restore, so it alone persists the open-tabs list (#295 multi-window).
    // A headless export opens the exported document as a tab; persisting that
    // would replace the user's saved session with it.
    if (initializing || !isPrimaryWindow() || isCliExportProcess()) return;
    const root = workspace?.root ?? null;
    const persisted: PersistedTab[] = [];
    if (root) {
      persisted.push({ kind: "folder", path: root });
    }
    for (const tab of tabs) {
      // Graph tabs and workspace-internal files live in the per-workspace
      // snapshot; unsaved in-memory buffers have no disk path to restore to.
      if (tab.kind !== "file" || tab.file.virtual) continue;
      if (root && isPathInside(tab.file.path, root)) continue;
      persisted.push({ kind: "file", path: tab.file.path });
    }
    optionsRef.current.onSettingsChange("behavior.openTabs", persisted);
    const activeTabPath = activeTab ? tabPathOf(activeTab) : "";
    optionsRef.current.onSettingsChange("behavior.activeTabPath", activeTabPath);
  }, [tabs, activeTab, workspace, initializing, optionsRef]);

  // Initialize: load CLI arg, restore workspace + tabs, or reopen last file
  // biome-ignore lint/correctness/useExhaustiveDependencies: mount-only effect
  useEffect(() => {
    // `get_initial_file` / `get_initial_folder` consume their value, so a second
    // run reads None and would fall through to session restore, replacing the
    // folder the CLI just opened. StrictMode double-invokes effects in dev, so
    // this must run exactly once per mount lifetime.
    if (didInit.current) return;
    didInit.current = true;
    (async () => {
      const options = optionsRef.current;
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
            // Migration (#226): a legacy global session carried the
            // workspace's tabs inline. Seed the workspace's first snapshot
            // from them, then the slimmed global writes take over.
            if (!(await getWorkspaceSession(folderEntry.path))) {
              saveWorkspaceSession(
                folderEntry.path,
                buildSessionFromLegacy(folderEntry.path, persistedTabs, options.activeTabPath),
              );
            }
            // Silent: if the folder became nested between sessions, skip it
            // rather than banner the user on every launch. The snapshot
            // restore inside openFolder reopens the workspace's tabs.
            await openFolder(folderEntry.path, { silent: true });
          }
          // The folder may have been refused (nested workspace, resolve
          // error); its files then reopen as loose tabs instead of vanishing.
          const adopted = workspaceRef.current?.root === folderEntry?.path;
          for (const persisted of persistedTabs) {
            if (persisted.kind !== "file") continue;
            // Workspace files came back with the snapshot above.
            if (adopted && folderEntry && isPathInside(persisted.path, folderEntry.path)) {
              continue;
            }
            await openFile(persisted.path);
          }
          if (options.activeTabPath) {
            activateTabByPath(options.activeTabPath);
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

  return { initializing };
}
