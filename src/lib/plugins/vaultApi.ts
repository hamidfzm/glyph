import { invoke } from "@tauri-apps/api/core";
import type { Backlink } from "@/lib/vault";
import { onPluginAppStateChange, pluginAppState } from "./appState";
import type { VaultApi } from "./types";
import { requireWorkspaceRead, requireWorkspaceRoot } from "./workspaceApi";

/**
 * Read-only queries over the workspace index, for plugins that declared
 * `workspace:read`. The graph and tag counts come from the snapshot the app
 * already holds, as copies: the app renders from the same objects, and a
 * plugin laying out a graph rewrites its edges in place. Per-note and per-tag
 * answers are asked of the Rust index, which checks the workspace grant itself.
 */
export function createVaultApi(
  getRoot: () => string | null,
  permissions: readonly string[],
): VaultApi {
  const indexedRoot = (): string | null => {
    const root = requireWorkspaceRoot(getRoot, permissions);
    // An empty index has nothing to answer with.
    return pluginAppState().snapshot.files.length > 0 ? root : null;
  };

  return {
    async graph() {
      requireWorkspaceRoot(getRoot, permissions);
      const { nodes, edges } = pluginAppState().snapshot.graph;
      return {
        nodes: nodes.map((node) => ({ ...node })),
        edges: edges.map((edge) => ({ ...edge })),
      };
    },
    async tags() {
      requireWorkspaceRoot(getRoot, permissions);
      return pluginAppState().snapshot.tagCounts.map((count) => ({ ...count }));
    },
    async backlinks(path) {
      const root = indexedRoot();
      if (!root) return [];
      return invoke<Backlink[]>("vault_backlinks", { root, path });
    },
    async pathsWithTag(tag) {
      const root = indexedRoot();
      if (!root) return [];
      return invoke<string[]>("vault_paths_with_tag", { root, tag });
    },
    async status() {
      requireWorkspaceRoot(getRoot, permissions);
      return { truncated: pluginAppState().snapshot.status.truncated };
    },
    onChange(listener) {
      requireWorkspaceRead(permissions);
      return onPluginAppStateChange("vault", listener);
    },
  };
}
