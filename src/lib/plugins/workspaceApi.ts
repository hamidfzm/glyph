import { invoke } from "@tauri-apps/api/core";
import type { FileScan } from "@/lib/workspaceScan";
import { onPluginAppStateChange } from "./appState";
import type { WorkspaceApi } from "./types";
import { resolveInsideRoot } from "./workspacePath";

/** Refuse a plugin that did not declare `workspace:read`. */
export function requireWorkspaceRead(permissions: readonly string[]): void {
  if (!permissions.includes("workspace:read")) {
    throw new Error('this plugin did not declare the "workspace:read" permission');
  }
}

/** The opened workspace root, for a plugin allowed to read it. */
export function requireWorkspaceRoot(
  getRoot: () => string | null,
  permissions: readonly string[],
): string {
  requireWorkspaceRead(permissions);
  const root = getRoot();
  if (!root) throw new Error("no workspace is open");
  return root;
}

/**
 * The mediated file door for plugins: reads go through the host's Rust
 * commands, are confined to the opened workspace, and require the plugin to
 * have declared the `workspace:read` permission (which the user saw and
 * accepted at install time). No workspace open means no access.
 */
export function createWorkspaceApi(
  getRoot: () => string | null,
  permissions: readonly string[],
): WorkspaceApi {
  return {
    async readFile(path) {
      const root = requireWorkspaceRoot(getRoot, permissions);
      const resolved = resolveInsideRoot(root, path);
      if (!resolved) throw new Error(`path is outside the workspace: ${path}`);
      return invoke<string>("read_file", { path: resolved });
    },
    async listFiles() {
      const root = requireWorkspaceRoot(getRoot, permissions);
      const scan = await invoke<FileScan>("list_markdown_files", { path: root });
      return scan.files;
    },
    getRoot() {
      requireWorkspaceRead(permissions);
      return getRoot();
    },
    onChange(listener) {
      requireWorkspaceRead(permissions);
      return onPluginAppStateChange("workspace", listener);
    },
  };
}
