// Jupyter notebooks are a separate document type from markdown. Unlike the
// markdown extension list (driven by tauri.conf.json fileAssociations), the
// notebook extension is fixed — `.ipynb` is the only one Jupyter ever uses — so
// it lives here as a plain constant.
//
// Notebooks are intentionally NOT registered as an OS file association (only
// markdown is). They open via the CLI, the open dialog, drag-and-drop, and the
// workspace file tree. The Rust side mirrors this in src-tauri/src/notebook.rs.

import { isMarkdownFile } from "./markdownExtensions";

export const NOTEBOOK_EXTENSIONS: readonly string[] = ["ipynb"];

export function isNotebookFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext ? NOTEBOOK_EXTENSIONS.includes(ext) : false;
}

/** Any document Glyph can open: markdown or a Jupyter notebook. */
export function isSupportedFile(path: string): boolean {
  return isMarkdownFile(path) || isNotebookFile(path);
}
