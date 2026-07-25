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

// True when the marker sits immediately outside the selection and is not part
// of a longer run of the same character. The run check keeps italic (`*`) from
// stripping one asterisk off a bold (`**`) span, which would turn bold into
// italic instead of adding emphasis.
function isWrappedBy(state: EditorState, from: number, to: number, marker: string): boolean {
  const len = marker.length;
  if (from - len < 0 || to + len > state.doc.length) return false;
  if (state.sliceDoc(from - len, from) !== marker) return false;
  if (state.sliceDoc(to, to + len) !== marker) return false;

  const char = marker[0];
  const runsLonger =
    (from - len > 0 && state.sliceDoc(from - len - 1, from - len) === char) ||
    (to + len < state.doc.length && state.sliceDoc(to + len, to + len + 1) === char);
  return !runsLonger;
}

/**
 * Toggle a symmetric marker around the selection, e.g. `**` for bold. Adds the
 * marker, or removes it when the selection is already wrapped, so pressing the
 * same action twice returns the original text instead of nesting forever.
 */
export function wrapSelectionWith(state: EditorState, marker: string): TransactionSpec | null {
  const { from, to, empty } = state.selection.main;
  if (empty) return null;

  const len = marker.length;
  if (isWrappedBy(state, from, to, marker)) {
    return {
      changes: [
        { from: from - len, to: from },
        { from: to, to: to + len },
      ],
      selection: { anchor: from - len, head: to - len },
    };
  }

  // The markers may sit inside the selection instead (e.g. selecting `*foo*`).
  const inner = state.sliceDoc(from, to);
  if (inner.length > 2 * len && inner.startsWith(marker) && inner.endsWith(marker)) {
    return {
      changes: { from, to, insert: inner.slice(len, -len) },
      selection: { anchor: from, head: to - 2 * len },
    };
  }

  return wrapWith(state, marker, marker);
}

// A keyboard command that toggles the marker around the selection. Reports
// false on an empty selection so the key falls through to the next binding.
export function wrapCommand(marker: string): Command {
  return (view) => {
    const spec = wrapSelectionWith(view.state, marker);
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
        const spec = wrapSelectionWith(view.state, marker);
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
