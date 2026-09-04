import { openSearchPanel, replaceAll, SearchQuery, setSearchQuery } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEditorExtensions, externalContentSync } from "./editorExtensions";

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
  const onSearchPanelClose = vi.fn();
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
        searchPhrasesCompartment: new Compartment(),
        searchPhrases: EditorState.phrases.of({ Find: "Buscar", "replace all": "Reemplazar todo" }),
        onDocChange,
        onSearchPanelClose,
      }),
    }),
    parent,
  });
  return { view, onDocChange, onSearchPanelClose };
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

  it("leaves the host alone for an external content sync", () => {
    // The host just handed this text over; echoing it back would have the two
    // sides overwrite each other until React aborts the update loop.
    const { view, onDocChange } = mount("start");
    view.dispatch({
      changes: { from: 0, to: 5, insert: "reloaded" },
      annotations: externalContentSync.of(true),
    });
    expect(view.state.doc.toString()).toBe("reloaded");
    expect(onDocChange).not.toHaveBeenCalled();
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

  it("labels the search panel from the configured phrases", () => {
    const { view } = mount("hello");
    openSearchPanel(view);
    const panel = view.dom.querySelector(".cm-panel.cm-search");
    expect(panel?.querySelector("input")?.getAttribute("placeholder")).toBe("Buscar");
    expect(panel?.querySelector("button[name=replaceAll]")?.textContent).toBe("Reemplazar todo");
  });

  it("offers replace controls for a writable document", () => {
    const { view } = mount("hello");
    openSearchPanel(view);
    expect(view.dom.querySelector(".cm-panel.cm-search button[name=replace]")).not.toBeNull();
  });

  it("replaces every match and reports the new document once", () => {
    const { view, onDocChange } = mount("cat cat cat");
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "cat", replace: "dog" })),
    });
    replaceAll(view);
    expect(view.state.doc.toString()).toBe("dog dog dog");
    expect(onDocChange).toHaveBeenCalledWith("dog dog dog");
  });

  it("undoes a replace-all in one step", () => {
    const { view } = mount("cat cat cat");
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "cat", replace: "dog" })),
    });
    replaceAll(view);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", code: "KeyZ", ctrlKey: true, bubbles: true }),
    );
    expect(view.state.doc.toString()).toBe("cat cat cat");
  });

  it("reports back when the panel is closed from inside", () => {
    const { view, onSearchPanelClose } = mount("hello");
    openSearchPanel(view);
    expect(onSearchPanelClose).not.toHaveBeenCalled();
    view.dom
      .querySelector<HTMLButtonElement>(".cm-panel.cm-search button[name=close]")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSearchPanelClose).toHaveBeenCalled();
  });

  it("opens the editor menu on right-click", () => {
    const { view } = mount("bold");
    view.contentDOM.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 }),
    );
    expect(document.querySelector(".cm-editor-menu")?.textContent).toContain("Bold");
  });
});
