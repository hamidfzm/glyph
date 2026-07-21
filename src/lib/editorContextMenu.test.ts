import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { editorContextMenu } from "./editorContextMenu";

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

function mount(selection: { anchor: number; head?: number }) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc: "foo bar",
      selection,
      extensions: [editorContextMenu(() => LABELS)],
    }),
    parent,
  });
  return { view, parent };
}

function rightClick(view: EditorView, init: MouseEventInit = {}) {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    clientX: 10,
    clientY: 10,
    ...init,
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

const menu = () => document.querySelector(".cm-editor-menu");
const items = () => [...(menu()?.querySelectorAll("button") ?? [])];

afterEach(() => {
  for (const node of document.querySelectorAll(".cm-editor-menu")) node.remove();
});

describe("editorContextMenu", () => {
  it("replaces the native menu with the themed one", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    const event = rightClick(view);
    expect(event.defaultPrevented).toBe(true);
    expect(items().map((b) => b.textContent)).toEqual([
      "Bold",
      "Italic",
      "Inline code",
      "Strikethrough",
      "Cut",
      "Copy",
      "Paste",
      "Select all",
    ]);
    view.destroy();
    parent.remove();
  });

  it("wraps the selection when a formatting entry is clicked", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    items()
      .find((b) => b.textContent === "Bold")
      ?.click();
    expect(view.state.doc.toString()).toBe("**foo** bar");
    expect(menu()).toBeNull();
    view.destroy();
    parent.remove();
  });

  it("disables selection-only entries when nothing is selected", () => {
    const { view, parent } = mount({ anchor: 1 });
    rightClick(view);
    const disabled = items()
      .filter((b) => b.disabled)
      .map((b) => b.textContent);
    expect(disabled).toEqual(["Bold", "Italic", "Inline code", "Strikethrough", "Cut", "Copy"]);
    view.destroy();
    parent.remove();
  });

  it("selects the whole document from Select all", () => {
    const { view, parent } = mount({ anchor: 1 });
    rightClick(view);
    items()
      .find((b) => b.textContent === "Select all")
      ?.click();
    expect(view.state.selection.main.to).toBe(7);
    view.destroy();
    parent.remove();
  });

  it("defers to a handler that already claimed the event (spell check)", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    event.preventDefault();
    view.contentDOM.dispatchEvent(event);
    expect(menu()).toBeNull();
    view.destroy();
    parent.remove();
  });
});
