import { defaultKeymap, history, historyKeymap, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import {
  formatBindingsExtension,
  wrapCommand,
  wrapSelection,
  wrapSelectionExtension,
  wrapSelectionWith,
} from "./editorWrapSelection";

// Apply wrapSelection and return the resulting doc + selection for assertions.
function applyWrap(state: EditorState, marker: string) {
  const spec = wrapSelection(state, marker);
  if (!spec) return null;
  const next = state.update(spec).state;
  return { doc: next.doc.toString(), selection: next.selection };
}

describe("wrapSelection", () => {
  it("wraps the selected text and keeps the inner text selected", () => {
    const state = EditorState.create({ doc: "foo", selection: { anchor: 0, head: 3 } });
    const result = applyWrap(state, "*");
    expect(result?.doc).toBe("*foo*");
    expect(result?.selection.main.from).toBe(1);
    expect(result?.selection.main.to).toBe(4);
  });

  it("nests markers when the wrap is repeated", () => {
    const initial = EditorState.create({ doc: "foo", selection: { anchor: 0, head: 3 } });
    const first = initial.update(wrapSelection(initial, "*")!).state;
    const second = first.update(wrapSelection(first, "*")!).state;
    expect(second.doc.toString()).toBe("**foo**");
    expect(second.selection.main.from).toBe(2);
    expect(second.selection.main.to).toBe(5);
  });

  it("keeps a right-to-left selection reversed after wrapping", () => {
    const state = EditorState.create({ doc: "foo", selection: { anchor: 3, head: 0 } });
    const result = applyWrap(state, "*");
    expect(result?.doc).toBe("*foo*");
    expect(result?.selection.main.anchor).toBe(4);
    expect(result?.selection.main.head).toBe(1);
  });

  it("returns null when nothing is selected", () => {
    const state = EditorState.create({ doc: "foo", selection: { anchor: 1 } });
    expect(wrapSelection(state, "*")).toBeNull();
  });

  it("returns null for characters that are not styling markers", () => {
    const state = EditorState.create({ doc: "foo", selection: { anchor: 0, head: 3 } });
    expect(wrapSelection(state, "x")).toBeNull();
  });

  it.each(Object.entries({ "*": "*foo*", _: "_foo_", "`": "`foo`", "~": "~foo~" }))(
    "wraps with the %s marker",
    (marker, expected) => {
      const state = EditorState.create({ doc: "foo", selection: { anchor: 0, head: 3 } });
      expect(applyWrap(state, marker)?.doc).toBe(expected);
    },
  );
});

describe("formatBindingsExtension", () => {
  // Drive the shipped extension the way CodeMirror does: dispatch a real
  // keydown at the editor's DOM and let the handler claim it.
  function pressWith(accelerators: Record<string, string>, init: KeyboardEventInit) {
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo bar",
        selection: { anchor: 0, head: 3 },
        extensions: [
          formatBindingsExtension(() => ({
            resolved: new Map(Object.entries(accelerators)),
            platform: "windows",
          })),
        ],
      }),
    });
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    view.contentDOM.dispatchEvent(event);
    const doc = view.state.doc.toString();
    view.destroy();
    return { doc, handled: event.defaultPrevented };
  }

  it("wraps in bold on the configured accelerator", () => {
    const { doc, handled } = pressWith(
      { "format-bold": "CmdOrCtrl+Shift+B" },
      { key: "B", code: "KeyB", ctrlKey: true, shiftKey: true },
    );
    expect(handled).toBe(true);
    expect(doc).toBe("**foo** bar");
  });

  it("honours a remapped accelerator", () => {
    // Same command, rebound to plain CmdOrCtrl+B.
    const { doc } = pressWith(
      { "format-bold": "CmdOrCtrl+B" },
      { key: "b", code: "KeyB", ctrlKey: true },
    );
    expect(doc).toBe("**foo** bar");
  });

  it("ignores a keystroke that matches no formatting binding", () => {
    const { doc, handled } = pressWith(
      { "format-bold": "CmdOrCtrl+Shift+B" },
      { key: "d", code: "KeyD", ctrlKey: true },
    );
    expect(handled).toBe(false);
    expect(doc).toBe("foo bar");
  });
});

describe("wrapCommand", () => {
  function runOn(doc: string, selection: { anchor: number; head?: number }, marker: string) {
    const view = new EditorView({ state: EditorState.create({ doc, selection }) });
    const handled = wrapCommand(marker)(view);
    const result = { handled, doc: view.state.doc.toString(), sel: view.state.selection.main };
    view.destroy();
    return result;
  }

  it("wraps with a two-character marker for bold", () => {
    const { handled, doc, sel } = runOn("foo", { anchor: 0, head: 3 }, "**");
    expect(handled).toBe(true);
    expect(doc).toBe("**foo**");
    // Inner text stays selected so the next command nests around it.
    expect([sel.from, sel.to]).toEqual([2, 5]);
  });

  it("wraps with a single-character marker for italic", () => {
    expect(runOn("foo", { anchor: 0, head: 3 }, "*").doc).toBe("*foo*");
  });

  it("reports false on an empty selection so the key falls through", () => {
    const { handled, doc } = runOn("foo", { anchor: 1 }, "**");
    expect(handled).toBe(false);
    expect(doc).toBe("foo");
  });
});

// Drive the shipped extension through a real EditorView: read the inputHandler
// facet it registers and call it the way CodeMirror does on a keystroke.
describe("wrapSelectionExtension", () => {
  function viewWith(doc: string, selection: { anchor: number; head?: number }) {
    return new EditorView({
      state: EditorState.create({ doc, selection, extensions: [wrapSelectionExtension] }),
    });
  }

  function typeInto(view: EditorView, text: string): boolean {
    const { from, to } = view.state.selection.main;
    return view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, from, to, text, () => view.state.update()));
  }

  it("intercepts a marker keystroke on a selection and wraps it", () => {
    const view = viewWith("foo", { anchor: 0, head: 3 });
    expect(typeInto(view, "*")).toBe(true);
    expect(view.state.doc.toString()).toBe("*foo*");
    view.destroy();
  });

  it("lets a marker keystroke pass through when nothing is selected", () => {
    const view = viewWith("foo", { anchor: 1 });
    expect(typeInto(view, "*")).toBe(false);
    expect(view.state.doc.toString()).toBe("foo");
    view.destroy();
  });

  it("lets a non-styling character pass through", () => {
    const view = viewWith("foo", { anchor: 0, head: 3 });
    expect(typeInto(view, "x")).toBe(false);
    view.destroy();
  });

  it("does not wrap while a composition is in progress (IME / dead keys)", () => {
    const view = viewWith("foo", { anchor: 0, head: 3 });
    Object.defineProperty(view, "compositionStarted", { get: () => true });
    expect(typeInto(view, "`")).toBe(false);
    expect(view.state.doc.toString()).toBe("foo");
    view.destroy();
  });
});

describe("formatBindingsExtension precedence", () => {
  // defaultKeymap binds Mod-i to selectParentSyntax with preventDefault, so the
  // formatting handler must be installed ahead of the keymap or italic is eaten.
  it("wins over defaultKeymap's Mod-i binding", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo bar",
        selection: { anchor: 0, head: 3 },
        extensions: [
          formatBindingsExtension(() => ({
            resolved: new Map([["format-italic", "CmdOrCtrl+I"]]),
            platform: "windows",
          })),
          keymap.of(defaultKeymap),
        ],
      }),
    });
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "i",
        code: "KeyI",
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(view.state.doc.toString()).toBe("*foo* bar");
    view.destroy();
  });
});

describe("wrapSelectionWith toggling", () => {
  const stateWith = (doc: string, anchor: number, head: number) =>
    EditorState.create({ doc, selection: { anchor, head } });

  const apply = (state: EditorState, marker: string) => {
    const spec = wrapSelectionWith(state, marker);
    if (!spec) return null;
    const next = state.update(spec).state;
    return { doc: next.doc.toString(), sel: next.selection.main };
  };

  it("removes the marker when the selection is already wrapped", () => {
    // "*foo*" with "foo" selected: pressing italic again unwraps it.
    const result = apply(stateWith("*foo* bar", 1, 4), "*");
    expect(result?.doc).toBe("foo bar");
    expect([result?.sel.from, result?.sel.to]).toEqual([0, 3]);
  });

  it("round-trips instead of nesting forever", () => {
    let state = stateWith("foo bar", 0, 3);
    state = state.update(wrapSelectionWith(state, "*")!).state;
    expect(state.doc.toString()).toBe("*foo* bar");
    state = state.update(wrapSelectionWith(state, "*")!).state;
    expect(state.doc.toString()).toBe("foo bar");
  });

  it("unwraps when the markers are inside the selection", () => {
    const result = apply(stateWith("*foo* bar", 0, 5), "*");
    expect(result?.doc).toBe("foo bar");
  });

  it("adds emphasis to a bold span rather than stripping one asterisk", () => {
    // "**foo**" with "foo" selected: italic must nest, not turn bold into italic.
    const result = apply(stateWith("**foo**", 2, 5), "*");
    expect(result?.doc).toBe("***foo***");
  });

  it("unwraps bold with the two-character marker", () => {
    const result = apply(stateWith("**foo**", 2, 5), "**");
    expect(result?.doc).toBe("foo");
  });
});

describe("formatting undo", () => {
  it("reverts a formatting change with the history command", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo bar",
        selection: { anchor: 0, head: 3 },
        extensions: [history(), keymap.of(historyKeymap)],
      }),
    });
    view.dispatch(wrapSelectionWith(view.state, "**")!);
    expect(view.state.doc.toString()).toBe("**foo** bar");
    undo(view);
    expect(view.state.doc.toString()).toBe("foo bar");
    view.destroy();
  });
});

describe("toggle boundary conditions", () => {
  it("wraps rather than unwraps at the very start of the document", () => {
    // No room for a marker before the selection, so the unwrap check bails.
    const state = EditorState.create({ doc: "foo*", selection: { anchor: 0, head: 3 } });
    expect(state.update(wrapSelectionWith(state, "*")!).state.doc.toString()).toBe("*foo**");
  });

  it("wraps rather than unwraps at the very end of the document", () => {
    const state = EditorState.create({ doc: "*foo", selection: { anchor: 1, head: 4 } });
    expect(state.update(wrapSelectionWith(state, "*")!).state.doc.toString()).toBe("**foo*");
  });

  it("claims the shortcut but makes no edit without a selection", () => {
    const view = new EditorView({
      state: EditorState.create({
        doc: "foo bar",
        selection: { anchor: 2 },
        extensions: [
          formatBindingsExtension(() => ({
            resolved: new Map([["format-bold", "CmdOrCtrl+Shift+B"]]),
            platform: "windows",
          })),
        ],
      }),
    });
    const event = new KeyboardEvent("keydown", {
      key: "B",
      code: "KeyB",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("foo bar");
    view.destroy();
  });
});

describe("toggle only unwraps a matched pair", () => {
  const roundTrip = (doc: string, anchor: number, head: number, marker: string) => {
    const state = EditorState.create({ doc, selection: { anchor, head } });
    return state.update(wrapSelectionWith(state, marker)!).state.doc.toString();
  };

  it("wraps when the preceding character is not the marker", () => {
    expect(roundTrip("xfoox", 1, 4, "*")).toBe("x*foo*x");
  });

  it("wraps when only the preceding character is the marker", () => {
    // Marker before but not after, so this is not a pair to strip.
    expect(roundTrip("*fooy", 1, 4, "*")).toBe("**foo*y");
  });
});
