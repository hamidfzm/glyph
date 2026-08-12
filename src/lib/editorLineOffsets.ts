import type { EditorView } from "@codemirror/view";

// CodeMirror block geometry is measured from the top of the document, while
// scrollTop is measured from the top of the scroller. `documentTop` is the
// document's position on screen, so it converts between the two.

function clamp01(value: number) {
  return Math.min(Math.max(value, 0), 1);
}

/** The source line at the top of the editor's viewport, fractional within its block. */
export function topVisibleLine(view: EditorView): number {
  const rect = view.scrollDOM.getBoundingClientRect();
  const block = view.elementAtHeight(rect.top - view.documentTop);
  const line = view.state.doc.lineAt(block.from).number;
  if (block.height <= 0) return line;
  return line + clamp01((rect.top - view.documentTop - block.top) / block.height);
}

/** The scrollTop that puts `line` at the top of the editor's viewport. */
export function offsetForEditorLine(view: EditorView, line: number): number {
  const doc = view.state.doc;
  const whole = Math.min(Math.max(Math.floor(line), 1), doc.lines);
  const block = view.lineBlockAt(doc.line(whole).from);
  const screenY = view.documentTop + block.top + clamp01(line - whole) * block.height;
  return view.scrollDOM.scrollTop + (screenY - view.scrollDOM.getBoundingClientRect().top);
}
