import { CANVAS_EXTENSIONS, hasExtension } from "./extensionConfig";

export { CANVAS_EXTENSIONS };

/** JSON Canvas (https://jsoncanvas.org), a document type of its own, not markdown. */
export function isCanvasFile(path: string): boolean {
  return hasExtension(path, CANVAS_EXTENSIONS);
}
