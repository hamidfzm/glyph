import type { NavigationApi } from "./types";
import { resolveInsideRoot } from "./workspacePath";

type FileOpener = (path: string, line?: number) => void;

// Set by usePluginAppBridge: opening a file belongs to the tabs context, which
// the plain modules building the plugin context cannot reach.
let fileOpener: FileOpener | null = null;

export function setPluginFileOpener(next: FileOpener | null): void {
  fileOpener = next;
}

/** `path` without the workspace root in front, or as given when it is not under it. */
function relativeToWorkspace(root: string, path: string): string {
  // A drive root (`D:\`) already ends in its separator.
  const base = root.replace(/[\\/]+$/, "");
  const next = path.charAt(base.length);
  const isUnderRoot = path.startsWith(base) && (next === "/" || next === "\\");
  return isUnderRoot ? path.slice(base.length).replace(/^[\\/]+/, "") : path;
}

/**
 * Lets a plugin open workspace files, by absolute path (as the vault queries
 * return them) or relative to the workspace root. Either form comes out as the
 * one normalized path the tabs know a file by, so a note already open is
 * switched to rather than opened twice. The read itself still passes the
 * backend grant check like any other open.
 */
export function createNavigationApi(getRoot: () => string | null): NavigationApi {
  return {
    openFile(path, options) {
      const root = getRoot();
      if (!root) throw new Error("no workspace is open");
      const target = resolveInsideRoot(root, relativeToWorkspace(root, path));
      if (!target) throw new Error(`path is outside the workspace: ${path}`);
      fileOpener?.(target, options?.line);
    },
  };
}
