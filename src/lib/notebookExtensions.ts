import { isCanvasFile } from "./canvasExtensions";
import { hasExtension, NOTEBOOK_EXTENSIONS } from "./extensionConfig";
import { isMarkdownFile } from "./markdownExtensions";
import { isSourceDocument } from "./sourceDocuments";

export { NOTEBOOK_EXTENSIONS };

export function isNotebookFile(path: string): boolean {
  return hasExtension(path, NOTEBOOK_EXTENSIONS);
}

/** Any document Glyph can open: markdown, a Jupyter notebook, a canvas, or a source document. */
export function isSupportedFile(path: string): boolean {
  return (
    isMarkdownFile(path) || isNotebookFile(path) || isCanvasFile(path) || isSourceDocument(path)
  );
}
