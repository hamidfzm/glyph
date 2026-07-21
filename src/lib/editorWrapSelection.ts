import type { EditorState, Extension, TransactionSpec } from "@codemirror/state";
import { type Command, EditorView } from "@codemirror/view";
import type { Platform } from "@/hooks/usePlatform";
import { matchesAccelerator } from "@/lib/keybindings";

// Typed marker -> the character it pairs with. Markdown inline markers are
// symmetric, so open and close match. Adding a bracket/quote pair is one entry.
const WRAP_PAIRS: Record<string, string> = {
  "*": "*",
  _: "_",
  "`": "`",
  "~": "~",
};

// Surround the selection with `open`/`close`, keeping the inner text selected so
// repeated markers nest and both endpoints keep their direction. Returns null
// when nothing is selected.
function wrapWith(state: EditorState, open: string, close: string): TransactionSpec | null {
  const { from, to, anchor, head, empty } = state.selection.main;
  if (empty) return null;

  const inner = state.sliceDoc(from, to);
  return {
    changes: { from, to, insert: open + inner + close },
    selection: { anchor: anchor + open.length, head: head + open.length },
  };
}

// Wrap the selection with a typed single-character marker (`*`, `_`, `` ` ``, `~`).
// Returns null when `marker` isn't a known pair, letting the key type normally.
export function wrapSelection(state: EditorState, marker: string): TransactionSpec | null {
  const close = WRAP_PAIRS[marker];
  if (!close) return null;
  return wrapWith(state, marker, close);
}

// A keyboard command that wraps the selection, e.g. `**` for bold. Reports
// false on an empty selection so the key falls through to the next binding.
export function wrapCommand(marker: string): Command {
  return (view) => {
    const spec = wrapWith(view.state, marker, marker);
    if (!spec) return false;
    view.dispatch(spec);
    return true;
  };
}

// Bindable command id -> the marker it wraps with. Accelerators live in
// BINDABLE_COMMANDS so formatting is remappable in Settings -> Hotkeys like
// every other shortcut, instead of being hardcoded here.
const FORMAT_MARKERS: readonly (readonly [string, string])[] = [
  ["format-bold", "**"],
  ["format-italic", "*"],
  ["format-code", "`"],
  ["format-strikethrough", "~~"],
];

/** Resolved accelerators plus the platform they are matched against. */
export interface FormatBindings {
  resolved: Map<string, string>;
  platform: Platform;
}

// Formatting shortcuts, read through a getter so a remap takes effect without
// tearing down the editor. Handled on keydown (not a CodeMirror keymap) so the
// accelerator strings stay the single source of truth.
export function formatBindingsExtension(getBindings: () => FormatBindings): Extension {
  return EditorView.domEventHandlers({
    keydown(event, view) {
      const { resolved, platform } = getBindings();
      for (const [id, marker] of FORMAT_MARKERS) {
        const accelerator = resolved.get(id);
        if (!accelerator || !matchesAccelerator(event, accelerator, platform)) continue;
        const spec = wrapWith(view.state, marker, marker);
        // Claim the key even with no selection, so a formatting shortcut never
        // falls through and types a stray character.
        if (spec) view.dispatch(spec);
        event.preventDefault();
        return true;
      }
      return false;
    },
  });
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
