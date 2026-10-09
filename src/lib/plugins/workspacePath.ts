// Path containment for the plugin workspace API: a plugin may only read files
// inside the opened workspace, whatever separators or `..` segments it sends.

/**
 * The segments of a workspace-relative path, or `null` when the input is
 * absolute, escapes the root, or names the root itself. Either separator is
 * accepted.
 */
function workspaceSegments(relPath: string): string[] | null {
  // Absolute inputs (posix, Windows drive, or UNC) are rejected outright: the
  // API is documented as workspace-relative.
  if (/^([a-zA-Z]:|[\\/])/.test(relPath)) return null;

  const segments: string[] = [];
  for (const part of relPath.split(/[\\/]+/)) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (segments.length === 0) return null; // escape above the root
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  // "" / "." / "a/.." resolve to the root itself.
  return segments.length === 0 ? null : segments;
}

/**
 * Resolve `relPath` against `root` and return the absolute path, or `null`
 * when it does not name something inside the root. The result uses the
 * platform separator found in `root`.
 */
export function resolveInsideRoot(root: string, relPath: string): string | null {
  const segments = workspaceSegments(relPath);
  if (!segments) return null;
  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
  return `${base}${sep}${segments.join(sep)}`;
}

/** `relPath` as the forward-slash form the backend takes, or `null` as {@link resolveInsideRoot}. */
export function workspaceRelativePath(relPath: string): string | null {
  return workspaceSegments(relPath)?.join("/") ?? null;
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
 * Resolve a workspace file a plugin names by absolute path (as the vault
 * queries return them) or relative to the root. Either form comes out as the
 * one normalized path the tabs know a file by, or `null` when it is the root
 * itself or outside it.
 */
export function resolveWorkspacePath(root: string, path: string): string | null {
  return resolveInsideRoot(root, relativeToWorkspace(root, path));
}
