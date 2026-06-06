// Small cross-platform path helpers for the file tree. Paths come from the Rust
// directory reader using the host separator (`/` on Unix, `\` on Windows), so
// these accept either.

/** Directory portion of `path`, or `fallback` for a top-level entry. */
export function parentDir(path: string, fallback: string): string {
  const sep = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return sep > 0 ? path.slice(0, sep) : fallback;
}

/** True when `candidate` is `base` itself or a descendant (file or folder) of it. */
export function isPathInside(candidate: string, base: string): boolean {
  return (
    candidate === base || candidate.startsWith(`${base}/`) || candidate.startsWith(`${base}\\`)
  );
}
