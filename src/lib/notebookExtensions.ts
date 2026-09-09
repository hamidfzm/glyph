import { isCanvasFile } from "./canvasExtensions";
import { isD2File } from "./d2Extensions";
import { hasExtension, NOTEBOOK_EXTENSIONS } from "./extensionConfig";
import { isMarkdownFile } from "./markdownExtensions";

export { NOTEBOOK_EXTENSIONS };

export function isNotebookFile(path: string): boolean {
  return hasExtension(path, NOTEBOOK_EXTENSIONS);
}

/** Any document Glyph can open: markdown, a Jupyter notebook, a canvas, or a D2 diagram. */
export function isSupportedFile(path: string): boolean {
  return isMarkdownFile(path) || isNotebookFile(path) || isCanvasFile(path) || isD2File(path);
}
