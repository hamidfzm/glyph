// The same rule as the app's `relativeToRoot` (src/lib/paths.ts), which a core
// plugin cannot import; src/lib/paths.test.ts pins the two together.

/** `path` written relative to `root`, or just its file name when outside it. */
export function relativePath(path: string, root: string | null): string {
  if (root && (path.startsWith(`${root}/`) || path.startsWith(`${root}\\`))) {
    return path.slice(root.length + 1);
  }
  return path.replace(/^.*[/\\]/, "");
}
