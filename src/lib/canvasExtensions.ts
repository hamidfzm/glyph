// JSON Canvas (`.canvas`) is a separate document type from markdown, following
// the open spec at https://jsoncanvas.org. Like notebooks, the extension is
// fixed — `.canvas` is the only one the spec uses — so it lives here as a plain
// constant rather than in the tauri.conf.json fileAssociations list (which is
// markdown-only and drives `isMarkdownFile`).
//
// Canvas files open via the open dialog, CLI, drag-and-drop, and the workspace
// file tree, mirroring how notebooks are wired.

export const CANVAS_EXTENSIONS: readonly string[] = ["canvas"];

export function isCanvasFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? CANVAS_EXTENSIONS.includes(ext) : false;
}
