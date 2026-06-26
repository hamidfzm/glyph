// Image and SVG assets are not documents Glyph edits, but the file tree lists
// them and the image viewer displays them. Like notebooks and canvases, the
// extension set is fixed and lives here as a plain constant rather than in the
// tauri.conf.json fileAssociations list (which is markdown-only and drives
// `isMarkdownFile`).
//
// Images are deliberately kept out of `isSupportedFile` (the document set that
// feeds the graph and wikilink autocomplete). The file tree and `openFile`
// admit them on top of that gate. The Rust mirror is src-tauri/src/image.rs.

export const IMAGE_EXTENSIONS: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
];

export function isImageFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? IMAGE_EXTENSIONS.includes(ext) : false;
}

/**
 * Whether `path` is an SVG. SVGs are text, so the image viewer renders them
 * from their inlined markup (a `data:` URL) rather than the asset protocol.
 */
export function isSvgFile(path: string): boolean {
  return path.split(".").pop()?.toLowerCase() === "svg";
}
