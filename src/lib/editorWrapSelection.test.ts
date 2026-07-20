import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { wrapSelection, wrapSelectionExtension } from "./editorWrapSelection";

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
