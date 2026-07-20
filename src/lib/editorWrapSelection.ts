import type { EditorState, TransactionSpec } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// Typed marker -> the character it pairs with. Markdown inline markers are
// symmetric, so open and close match. Adding a bracket/quote pair is one entry.
const WRAP_PAIRS: Record<string, string> = {
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
  const { from, to, anchor, head, empty } = state.selection.main;
  if (empty) return null;

  const inner = state.sliceDoc(from, to);
  return {
    changes: { from, to, insert: marker + inner + close },
    // Shift both endpoints by the opening marker so the selection keeps its
    // direction (a right-to-left selection stays right-to-left).
    selection: { anchor: anchor + marker.length, head: head + marker.length },
  };
}

// Intercept typed styling markers before they replace the selection. Skips
// composition so dead keys (`` ` `` and `~` on US-International layouts) and IME
// input still compose accented characters instead of wrapping; paste already
// bypasses input handlers. Returning true suppresses the default insert.
export const wrapSelectionExtension = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (view.compositionStarted) return false;
  const spec = wrapSelection(view.state, text);
  if (!spec) return false;
  view.dispatch(spec);
  return true;
});
