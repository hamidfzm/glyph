import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { act, waitFor } from "@testing-library/react";
import { expect, vi } from "vitest";
import type { useTabs } from "@/hooks/useTabs";
import { pickFiles, pickFolder, pickNewWorkspace, pickSave } from "@/lib/pickers";
import { COMPLETE_SCAN } from "@/lib/workspaceScan";
import { resetWorkspaceSessions } from "@/lib/workspaceSession";

// Shared harness for the useTabs suites (useTabs.*.test.tsx). Each of those
// files mocks "@/lib/pickers" itself — vi.mock is per-module and hoisted — and
// calls resetTabsMocks in its beforeEach.

export type TabsHook = { current: ReturnType<typeof useTabs> };

export type Invoker = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

// The workspace scan commands return items plus a truncation status (#436).
export const fileScan = (files: string[]) => ({ files, status: COMPLETE_SCAN });
export const wikilinkScan = (refs: unknown[]) => ({ refs, status: COMPLETE_SCAN });
export const metadataScan = (files: unknown[]) => ({ files, status: COMPLETE_SCAN });

export function makeInvoker(overrides: Partial<Record<string, Invoker>> = {}): Invoker {
  return async (cmd, args) => {
    const fn = overrides[cmd];
    if (fn) return fn(cmd, args);
    switch (cmd) {
      case "get_initial_file":
      case "get_initial_folder":
        return null;
      case "read_file":
        return "FILE BODY";
      case "get_file_metadata":
        return {
          name:
            String(args?.path ?? "")
              .split("/")
              .pop() ?? "",
          path: String(args?.path ?? ""),
          size: 0,
          modified: 0,
        };
      case "window_showing_file":
        // No other window holds the note, so the open proceeds here.
        return false;
      case "set_window_files":
      case "watch_file":
      case "unwatch_file":
      case "watch_directory":
      case "unwatch_directory":
      case "write_file":
        return undefined;
      case "read_directory":
        return [];
      case "list_markdown_files":
        return fileScan([]);
      case "scan_wikilinks":
        return wikilinkScan([]);
      case "scan_metadata":
        return metadataScan([]);
      case "workspace_resolve":
        // Default: a plain, non-nested folder that's always adoptable.
        return {
          selected: String(args?.selected ?? ""),
          isGitRepo: false,
          gitTopLevel: null,
          nestedUnder: null,
          glyphConflict: null,
        };
      case "workspace_get_last_file":
        return null;
      case "workspace_set_last_file":
        return undefined;
      default:
        return undefined;
    }
  };
}

export function defaultOptions(over: Partial<Parameters<typeof useTabs>[0]> = {}) {
  return {
    reopenLastFile: false,
    openTabs: [] as string[],
    activeTabPath: "",
    recentFiles: [],
    autoReload: false,
    // Autosave on is the default, so close keeps flush-saving silently unless a
    // test opts into the Save / Don't Save / Cancel prompt (#563).
    autoSave: true,
    defaultEditorMode: "view" as const,
    onSettingsChange: vi.fn(),
    onWorkspaceNotice: vi.fn(),
    confirmUnsaved: vi.fn(async () => "cancel" as const),
    ...over,
  };
}

export function captureListener(
  event: "open-file" | "open-folder" | "file-changed" | "directory-changed",
) {
  const ref: { handler: ((e: { payload: string }) => void) | null } = { handler: null };
  vi.mocked(listen).mockImplementation(((name: string, fn: (e: { payload: string }) => void) => {
    if (name === event) ref.handler = fn;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  return ref;
}

export function watchDirectoryCalls(path: string) {
  return vi
    .mocked(invoke)
    .mock.calls.filter(
      (c) => c[0] === "watch_directory" && (c[1] as { path: string }).path === path,
    );
}

/** Reset every Tauri and picker mock to the defaults the suites assume. */
export function resetTabsMocks(): void {
  resetWorkspaceSessions();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(makeInvoker() as typeof invoke);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(pickFolder).mockReset();
  vi.mocked(pickFiles).mockReset();
  vi.mocked(pickSave).mockReset();
  vi.mocked(pickNewWorkspace).mockReset();
}

/** Open /p/a.md in edit mode and return its tab id, ready for save tests. */
export async function openEditable(result: TabsHook) {
  await waitFor(() => expect(result.current.initializing).toBe(false));
  await act(async () => {
    await result.current.openFile("/p/a.md");
  });
  const tabId = result.current.tabs[0].id;
  act(() => {
    result.current.setTabMode(tabId, "edit");
  });
  return tabId;
}

export function fileOf(result: TabsHook, index = 0) {
  const tab = result.current.tabs[index];
  if (tab.kind !== "file") throw new Error("expected a file tab");
  return tab.file;
}
