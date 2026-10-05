import type { NavigationApi } from "./types";
import { resolveWorkspacePath } from "./workspacePath";

type FileOpener = (path: string, line?: number) => void;

// Set by usePluginAppBridge: opening a file belongs to the tabs context, which
// the plain modules building the plugin context cannot reach.
let fileOpener: FileOpener | null = null;

export function setPluginFileOpener(next: FileOpener | null): void {
  fileOpener = next;
}

/**
 * Lets a plugin open workspace files, by absolute path or relative to the
 * workspace root. The path is normalized to the one spelling the tabs know a
 * file by, so a note already open is switched to rather than opened twice.
 * The read itself still passes the backend grant check like any other open.
 */
export function createNavigationApi(getRoot: () => string | null): NavigationApi {
  return {
    openFile(path, options) {
      const root = getRoot();
      if (!root) throw new Error("no workspace is open");
      const target = resolveWorkspacePath(root, path);
      if (!target) throw new Error(`path is outside the workspace: ${path}`);
      fileOpener?.(target, options?.line);
    },
  };
}
