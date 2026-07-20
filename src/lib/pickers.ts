import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isMobilePlatform } from "@/lib/platform";

/**
 * Backend-run native pickers replacing the JS dialog plugin's `open()`/`save()`:
 * the dialog runs in Rust and the choice is minted as a filesystem grant before
 * the path is returned. See docs/security/threat-model.md.
 *
 * Mobile is the exception: the Rust `pick` commands are desktop-only, so file
 * picking goes through the dialog plugin's OS document picker, and reads go
 * through the fs plugin (which owns the sandbox scope), not the Rust grants.
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
export async function pickFiles(filters: PickFilter[]): Promise<string[] | null> {
  if (isMobilePlatform()) {
    return open({ multiple: true, filters });
  }
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

/** Plugin-install picker; the backend stashes the choice for the next `install_plugin` call. */
export function pickPluginDir(): Promise<string | null> {
  return invoke<string | null>("pick_plugin_dir");
}

/** "Move to..." picker; mints no grant, `move_path` validates the destination. */
export function pickMoveDir(defaultDir: string): Promise<string | null> {
  return invoke<string | null>("pick_move_dir", { defaultDir });
}
