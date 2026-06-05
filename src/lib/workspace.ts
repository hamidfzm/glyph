// TypeScript mirror of the Rust workspace command surface in
// `src-tauri/src/workspace/`. The workspace model: one folder is one git repo's
// top level, with per-workspace config committed under `.glyph/`.
//
// Keep these in lockstep with the Rust definitions (camelCase serde).

import { invoke } from "@tauri-apps/api/core";

/** Result of resolving a selected folder against the one-workspace rule (#262). */
export interface WorkspaceResolution {
  /** The folder the user selected. */
  selected: string;
  /** Whether `selected` is inside any git working tree. */
  isGitRepo: boolean;
  /** The git working-tree top level, if a (non-bare) repo. */
  gitTopLevel: string | null;
  /**
   * Set when `selected` is a git repo but nested inside a parent `.git`
   * (the refusal case); the value is that parent's top level.
   */
  nestedUnder: string | null;
  /**
   * Set when an ancestor directory already holds a `.glyph/` (so the
   * selection would be a workspace nested inside another workspace); the value is
   * the ancestor that owns it.
   */
  glyphConflict: string | null;
}

/** Resolve a selected folder for the one-folder-one-workspace guard. */
export function resolveWorkspace(selected: string): Promise<WorkspaceResolution> {
  return invoke<WorkspaceResolution>("workspace_resolve", { selected });
}

/** The workspace's last-opened file as an absolute path, or `null`. */
export function getWorkspaceLastFile(workspaceRoot: string): Promise<string | null> {
  return invoke<string | null>("workspace_get_last_file", { workspaceRoot });
}

/** Record `filePath` (absolute) as the workspace's last-opened file. */
export function setWorkspaceLastFile(workspaceRoot: string, filePath: string): Promise<void> {
  return invoke("workspace_set_last_file", { workspaceRoot, filePath });
}
