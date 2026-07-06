import { invoke } from "@tauri-apps/api/core";
import type { WorkspaceApi } from "./types";
import { resolveInsideRoot } from "./workspacePath";

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
  const requireRoot = (): string => {
    if (!permissions.includes("workspace:read")) {
      throw new Error('this plugin did not declare the "workspace:read" permission');
    }
    const root = getRoot();
    if (!root) throw new Error("no workspace is open");
    return root;
  };

  return {
    async readFile(path) {
      const root = requireRoot();
      const resolved = resolveInsideRoot(root, path);
      if (!resolved) throw new Error(`path is outside the workspace: ${path}`);
      return invoke<string>("read_file", { path: resolved });
    },
    async listFiles() {
      const root = requireRoot();
      return invoke<string[]>("list_markdown_files", { path: root });
    },
  };
}
