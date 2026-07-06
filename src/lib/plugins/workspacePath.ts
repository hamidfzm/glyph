// Path containment for the plugin workspace API: a plugin may only read files
// inside the opened workspace, whatever separators or `..` segments it sends.

/**
 * Resolve `relPath` against `root` and return the absolute path, or `null`
 * when the input is absolute or escapes the root. Handles both `/` and `\`
 * separators; the result uses the platform separator found in `root`.
 */
export function resolveInsideRoot(root: string, relPath: string): string | null {
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
  if (segments.length === 0) return null; // "" / "." / "a/.." resolve to the root itself

  const sep = root.includes("\\") ? "\\" : "/";
  const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root;
  return `${base}${sep}${segments.join(sep)}`;
}
