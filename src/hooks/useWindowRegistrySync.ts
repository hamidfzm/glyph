import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isCliExportProcess } from "@/lib/cliExport";
import { type Tab, tabPathOf, type Workspace } from "@/lib/tabs";

/**
 * Report what this window shows to the Rust window registry: its folder
 * workspace and its open file tabs.
 *
 * Routing uses both to keep a path in at most one window. A request for a note
 * another window already shows focuses that window instead of opening a second
 * live buffer over it, which would give the file two independent autosave
 * chains and let the later write discard the other window's edits.
 *
 * Reports are suppressed until the window has finished initializing. A spawned
 * window is pre-registered against the path it was created for, and its first
 * render happens before the injected open has been adopted: reporting an empty
 * window there would erase that pre-registration and let a second request for
 * the same path spawn a duplicate window during the gap.
 */
export function useWindowRegistrySync(
  workspace: Workspace | null,
  tabs: Tab[],
  initializing: boolean,
): void {
  const root = workspace?.root ?? null;
  // Virtual buffers have no disk path to route to, and graph tabs are not
  // files. The joined key keeps the effect from re-invoking on tab reorder or
  // on unrelated tab state changes; NUL cannot appear in a path, so distinct
  // lists never collide on it.
  const paths = tabs
    .filter((tab) => tab.kind === "file" && !tab.file.virtual)
    .map((tab) => tabPathOf(tab));
  const key = paths.join("\0");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `paths` is derived from `key`, which is the real dependency
  useEffect(() => {
    // A headless export drives a throwaway window in its own process (--export
    // skips single-instance forwarding), so its registry is private and there
    // is nothing worth reporting into it.
    if (initializing || isCliExportProcess()) return;
    invoke("set_window_workspace", { root }).catch(() => {});
    invoke("set_window_files", { paths }).catch(() => {});
  }, [root, key, initializing]);
}
