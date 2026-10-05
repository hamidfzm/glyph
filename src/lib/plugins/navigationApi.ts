import { isPathInside } from "@/lib/paths";
import type { NavigationApi } from "./types";
import { resolveInsideRoot } from "./workspacePath";

type FileOpener = (path: string, line?: number) => void;

// Set by usePluginAppBridge: opening a file belongs to the tabs context, which
// the plain modules building the plugin context cannot reach.
let fileOpener: FileOpener | null = null;

export function setPluginFileOpener(next: FileOpener | null): void {
  fileOpener = next;
}

const PARENT_SEGMENT = /(^|[\\/])\.\.([\\/]|$)/;

function insideWorkspace(root: string, path: string): string | null {
  if (!isPathInside(path, root)) return resolveInsideRoot(root, path);
  if (path === root || PARENT_SEGMENT.test(path)) return null;
  return path;
}

/**
 * Lets a plugin open workspace files, by absolute path (as the vault queries
 * return them) or relative to the workspace root. The read itself still passes
 * the backend grant check like any other open.
 */
export function createNavigationApi(getRoot: () => string | null): NavigationApi {
  return {
    openFile(path, options) {
      const root = getRoot();
      if (!root) throw new Error("no workspace is open");
      const target = insideWorkspace(root, path);
      if (!target) throw new Error(`path is outside the workspace: ${path}`);
      fileOpener?.(target, options?.line);
    },
  };
}
