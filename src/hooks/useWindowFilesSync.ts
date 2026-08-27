import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { isCliExportProcess } from "@/lib/cliExport";
import { type Tab, tabPathOf } from "@/lib/tabs";

/**
 * Report this window's open file tabs to the Rust window registry, the same way
 * `useWorkspaceTree` reports its workspace root.
 *
 * Routing uses it to keep a file in at most one window: a request for a note
 * another window already shows focuses that window instead of opening a second
 * live buffer over the same path, which would give the file two independent
 * autosave chains.
 */
export function useWindowFilesSync(tabs: Tab[]): void {
  // Virtual buffers have no disk path to route to, and graph tabs are not
  // files. The joined key keeps the effect from re-invoking on tab reorder or
  // on unrelated tab state changes.
  const paths = tabs
    .filter((tab) => tab.kind === "file" && !tab.file.virtual)
    .map((tab) => tabPathOf(tab));
  const key = paths.join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `paths` is derived from `key`, which is the real dependency
  useEffect(() => {
    // A headless export drives a throwaway window; registering its tabs would
    // divert a real open request to a window that is about to exit.
    if (isCliExportProcess()) return;
    invoke("set_window_files", { paths }).catch(() => {});
  }, [key]);
}
