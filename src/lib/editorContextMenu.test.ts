import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("editorContextMenu clipboard and dismissal", () => {
  it("cuts and copies through the document command", () => {
    const exec = vi.fn();
    const original = document.execCommand;
    document.execCommand = exec as unknown as typeof document.execCommand;

    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    items()
      .find((b) => b.textContent === "Copy")
      ?.click();
    expect(exec).toHaveBeenCalledWith("copy");

    rightClick(view);
    items()
      .find((b) => b.textContent === "Cut")
      ?.click();
    expect(exec).toHaveBeenCalledWith("cut");

    document.execCommand = original;
    view.destroy();
    parent.remove();
  });

  it("pastes clipboard text over the selection", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.resolve("XY") },
      configurable: true,
    });
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    items()
      .find((b) => b.textContent === "Paste")
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.state.doc.toString()).toBe("XY bar");
    view.destroy();
    parent.remove();
  });

  it("closes on Escape", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    expect(menu()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(menu()).toBeNull();
    view.destroy();
    parent.remove();
  });

  it("closes when clicking outside", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).toBeNull();
    view.destroy();
    parent.remove();
  });

  it("replaces a previous menu instead of stacking", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    rightClick(view);
    expect(document.querySelectorAll(".cm-editor-menu")).toHaveLength(1);
    view.destroy();
    parent.remove();
  });
});

describe("editorContextMenu edge branches", () => {
  it("ignores keys other than Escape while open", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(menu()).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it("stays open when the click lands inside the menu", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    menu()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(menu()).not.toBeNull();
    view.destroy();
    parent.remove();
  });

  it("does nothing when the selection collapsed before the entry was clicked", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    // Entries read the selection at click time, not at menu-open time.
    view.dispatch({ selection: { anchor: 1 } });
    items()
      .find((b) => b.textContent === "Bold")
      ?.click();
    expect(view.state.doc.toString()).toBe("foo bar");
    view.destroy();
    parent.remove();
  });

  it("leaves the document alone when the clipboard is empty", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: () => Promise.resolve("") },
      configurable: true,
    });
    const { view, parent } = mount({ anchor: 0, head: 3 });
    rightClick(view);
    items()
      .find((b) => b.textContent === "Paste")
      ?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.state.doc.toString()).toBe("foo bar");
    view.destroy();
    parent.remove();
  });

  it("pulls the menu back inside the viewport near the edges", () => {
    const { view, parent } = mount({ anchor: 0, head: 3 });
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function rect() {
      return { width: 170, height: 200, right: 99999, bottom: 99999 } as DOMRect;
    };
    rightClick(view, { clientX: 5000, clientY: 5000 });
    Element.prototype.getBoundingClientRect = original;

    const style = (menu() as HTMLElement).style;
    expect(Number.parseInt(style.left, 10)).toBe(window.innerWidth - 170 - 4);
    expect(Number.parseInt(style.top, 10)).toBe(window.innerHeight - 200 - 4);
    view.destroy();
    parent.remove();
  });
});
