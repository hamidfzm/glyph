import { hasExtension, IMAGE_EXTENSIONS } from "./extensionConfig";

export { IMAGE_EXTENSIONS };

// Images are deliberately kept out of `isSupportedFile` (the document set that
// feeds the graph and wikilink autocomplete); the file tree and `openFile` admit
// them on top of that gate.
export function isImageFile(path: string): boolean {
  return hasExtension(path, IMAGE_EXTENSIONS);
}

/**
 * Whether `path` is an SVG. SVGs are text, so the image viewer renders them
 * from their inlined markup (a `data:` URL) rather than the asset protocol.
 */
export function isSvgFile(path: string): boolean {
  return hasExtension(path, ["svg"]);
}
