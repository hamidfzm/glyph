// Small cross-platform path helpers for the file tree. Paths come from the Rust
// directory reader using the host separator (`/` on Unix, `\` on Windows), so
// these accept either.

/** Directory portion of `path`, or `fallback` for a top-level entry. */
export function parentDir(path: string, fallback: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep > 0 ? path.slice(0, sep) : fallback;
}

/** Final path segment (file or folder name), with any directory prefix removed. */
export function basename(path: string): string {
  return path.replace(/^.*[/\\]/, "");
}

/** Final non-empty segment, so a directory path keeps its name whether or not
 *  it ends in a separator (`/a/b` and `/a/b/` both give `b`). */
export function lastSegment(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** File name with its extension removed; a name without one is unchanged. */
export function stem(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/** Human-readable file name from a plain path or a mobile picker URI
 *  (`file://` percent-encodes spaces; SAF `content://` URIs also encode
 *  separators, so strip again after decoding). */
export function displayName(path: string): string {
  const last = basename(path);
  try {
    return decodeURIComponent(last).replace(/^.*[/\\:]/, "");
  } catch {
    return last;
  }
}

/** `path` written relative to `root`, or just its file name when outside it. */
export function relativeToRoot(path: string, root: string): string {
  if (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`)) {
    return path.slice(root.length + 1);
  }
  return basename(path);
}

/** True when `candidate` is `base` itself or a descendant (file or folder) of it. */
export function isPathInside(candidate: string, base: string): boolean {
  return (
    candidate === base || candidate.startsWith(`${base}/`) || candidate.startsWith(`${base}\\`)
  );
}

/**
 * Call `remove` for every key that is `base` itself or inside it. Used to drop
 * cached directory listings / expanded entries when a folder is moved or
 * deleted. Kept as a synchronous helper so its branch is credited by coverage
 * (v8 doesn't credit branches that run after an `await`).
 */
export function pruneInside(
  keys: Iterable<string>,
  base: string,
  remove: (key: string) => void,
): void {
  for (const key of [...keys]) {
    if (isPathInside(key, base)) remove(key);
  }
}
