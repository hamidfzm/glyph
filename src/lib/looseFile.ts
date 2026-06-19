// A "loose" file tab holds a document opened from outside the window's
// workspace (e.g. a single file dropped in or opened from the OS while a folder
// is open). Glyph marks these distinctly, like JetBrains IDEs flag non-project
// files, so it's clear they aren't part of the workspace tree.

/**
 * True when `path` is a file outside `workspaceRoot`. With no workspace open
 * there's no project to contrast against, so nothing is treated as loose.
 */
export function isLooseFilePath(path: string, workspaceRoot: string | null | undefined): boolean {
  if (!workspaceRoot) return false;
  const inside =
    path === workspaceRoot ||
    path.startsWith(`${workspaceRoot}/`) ||
    path.startsWith(`${workspaceRoot}\\`);
  return !inside;
}
