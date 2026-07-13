import { invoke } from "@tauri-apps/api/core";

/**
 * Backend-run native file/folder pickers.
 *
 * These replace the JS dialog plugin's `open()`/`save()`: the dialog runs in
 * Rust, and the user's choice is minted as a filesystem grant there before
 * the path is returned, so filesystem commands only ever accept paths the
 * user actually picked (or opened via CLI/drag-drop/OS events). See
 * docs/security/threat-model.md.
 */

export interface PickFilter {
  name: string;
  extensions: string[];
}

/** Open Folder picker; grants the choice as a workspace. Null on cancel. */
export function pickFolder(): Promise<string | null> {
  return invoke<string | null>("pick_folder");
}

/** Multi-select file picker; grants each choice as a loose file. */
export function pickFiles(filters: PickFilter[]): Promise<string[] | null> {
  return invoke<string[] | null>("pick_files", { filters });
}

/** Save dialog for exports; grants the target write-only. */
export function pickSave(
  defaultName: string,
  filterName: string,
  extensions: string[],
): Promise<string | null> {
  return invoke<string | null>("pick_save", { defaultName, filterName, extensions });
}

/** Folder picker for website export; grants the folder write-only. */
export function pickExportDir(): Promise<string | null> {
  return invoke<string | null>("pick_export_dir");
}

/**
 * Folder picker for plugin installs. The backend stashes the choice for the
 * next `install_plugin` call instead of granting filesystem access.
 */
export function pickPluginDir(): Promise<string | null> {
  return invoke<string | null>("pick_plugin_dir");
}

/**
 * Folder picker for "Move to...". Mints no grant: the result is only ever
 * passed to `move_path`, which validates it against the workspace root.
 */
export function pickMoveDir(defaultDir: string): Promise<string | null> {
  return invoke<string | null>("pick_move_dir", { defaultDir });
}
