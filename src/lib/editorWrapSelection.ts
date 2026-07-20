import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Typed marker -> the character it pairs with. Markdown inline markers are
// symmetric, so open and close match. Adding a bracket/quote pair is one entry.
export const WRAP_PAIRS: Record<string, string> = {
  "*": "*",
  _: "_",
  "`": "`",
  "~": "~",
};

// Wrap the current selection with `marker`, keeping the inner text selected so
// repeated markers nest (`*` twice yields `**...**`). Returns null when `marker`
// isn't a known pair or nothing is selected, letting the marker type normally.
export function wrapSelection(state: EditorState, marker: string): TransactionSpec | null {
  const close = WRAP_PAIRS[marker];
  if (!close) return null;
  const { from, to } = state.selection.main;
  if (from === to) return null;

  const inner = state.sliceDoc(from, to);
  return {
    changes: { from, to, insert: marker + inner + close },
    selection: { anchor: from + marker.length, head: to + marker.length },
  };
}

// Intercept typed styling markers before they replace the selection. Only fires
// on real input (not paste or IME), so wrapping never triggers unexpectedly.
// Returning true suppresses the default insert that would replace the selection.
export const wrapSelectionExtension = EditorView.inputHandler.of((view, _from, _to, text) => {
  const spec = wrapSelection(view.state, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});
