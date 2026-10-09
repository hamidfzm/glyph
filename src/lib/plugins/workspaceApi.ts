import { invoke } from "@tauri-apps/api/core";
import type { FileScan } from "@/lib/workspaceScan";
import { onPluginAppStateChange } from "./appState";
import type { CreatedFile, PluginPermission, WorkspaceApi } from "./types";
import { resolveInsideRoot, workspaceRelativePath } from "./workspacePath";

function requirePermission(permissions: readonly string[], permission: PluginPermission): void {
  if (!permissions.includes(permission)) {
    throw new Error(`this plugin did not declare the "${permission}" permission`);
  }
}

/** Refuse a plugin that did not declare `workspace:read`. */
export function requireWorkspaceRead(permissions: readonly string[]): void {
  requirePermission(permissions, "workspace:read");
}

function openWorkspaceRoot(getRoot: () => string | null): string {
  const root = getRoot();
  if (!root) throw new Error("no workspace is open");
  return root;
}

/** The opened workspace root, for a plugin allowed to read it. */
export function requireWorkspaceRoot(
  getRoot: () => string | null,
  permissions: readonly string[],
): string {
  requireWorkspaceRead(permissions);
  return openWorkspaceRoot(getRoot);
}

/** The opened workspace root, for a plugin allowed to write to it. */
function requireWritableRoot(getRoot: () => string | null, permissions: readonly string[]): string {
  requirePermission(permissions, "workspace:write");
  return openWorkspaceRoot(getRoot);
}

/**
 * The mediated file door for plugins: every call goes through the host's Rust
 * commands, is confined to the opened workspace, and requires the permission
 * the plugin declared for it (`workspace:read` or `workspace:write`, which the
 * user saw and accepted at install time). No workspace open means no access.
 */
export function createWorkspaceApi(
  getRoot: () => string | null,
  permissions: readonly string[],
  pluginId: string,
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
    async createFile(path, content = "") {
      const root = requireWritableRoot(getRoot, permissions);
      const relative = workspaceRelativePath(path);
      if (!relative) throw new Error(`path is outside the workspace: ${path}`);
      return invoke<CreatedFile>("create_workspace_file", { root, path: relative, content });
    },
    async getSettings() {
      const workspaceRoot = requireWorkspaceRoot(getRoot, permissions);
      return invoke<Record<string, unknown>>("workspace_get_plugin_settings", {
        workspaceRoot,
        pluginId,
      });
    },
    async setSettings(settings) {
      const workspaceRoot = requireWritableRoot(getRoot, permissions);
      await invoke("workspace_set_plugin_settings", { workspaceRoot, pluginId, settings });
    },
  };
}
