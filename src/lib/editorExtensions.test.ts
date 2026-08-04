import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions } from "./editorExtensions";

const LABELS = {
  bold: "Bold",
  italic: "Italic",
  code: "Inline code",
  strikethrough: "Strikethrough",
  cut: "Cut",
  copy: "Copy",
  paste: "Paste",
  selectAll: "Select all",
};

// The whole list is mounted so the wiring is exercised in the order the
// extensions actually resolve; each extension has its own unit test alongside.
function mount(doc: string) {
  const onDocChange = vi.fn();
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: 0, head: doc.length },
      extensions: buildEditorExtensions({
        keymapPreset: "default",
        workspaceFilesRef: { current: [] },
        workspaceRootRef: { current: undefined },
        formatBindingsRef: {
          current: { resolved: new Map([["format-bold", "CmdOrCtrl+B"]]), platform: "windows" },
        },
        formatLabelsRef: { current: LABELS },
        pasteHtmlRef: { current: true },
        spellcheckCompartment: new Compartment(),
        spellcheckExtension: [],
        onDocChange,
      }),
    }),
    parent,
  });
  return { view, onDocChange };
}

afterEach(() => {
  for (const node of document.querySelectorAll(".cm-editor-menu")) node.remove();
  document.body.replaceChildren();
});

describe("buildEditorExtensions", () => {
  it("reports the new document on every change", () => {
    const { view, onDocChange } = mount("start");
    view.dispatch({ changes: { from: 5, insert: "!" } });
    expect(onDocChange).toHaveBeenCalledWith("start!");
  });

  it("leaves the host alone for a selection-only transaction", () => {
    const { view, onDocChange } = mount("start");
    view.dispatch({ selection: { anchor: 1 } });
    expect(onDocChange).not.toHaveBeenCalled();
  });

  it("wraps the selection when the bound format shortcut fires", () => {
    const { view } = mount("bold");
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { code: "KeyB", ctrlKey: true, bubbles: true }),
    );
    expect(view.state.doc.toString()).toBe("**bold**");
  });

  it("converts pasted rich text to markdown", () => {
    const { view } = mount("");
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { getData: (type: string) => (type === "text/html" ? "<em>hi</em>" : "hi") },
    });
    view.contentDOM.dispatchEvent(event);
    expect(view.state.doc.toString()).toBe("*hi*");
  });

  it("opens the editor menu on right-click", () => {
    const { view } = mount("bold");
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".cm-editor-menu")?.textContent).toContain("Bold");
  });
});
