import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { formatToolbar } from "./editorFormatToolbar";

const LABELS = {
  bold: "Bold",
  italic: "Italic",
  code: "Inline code",
  strikethrough: "Strikethrough",
};

function mount(doc: string, selection: { anchor: number; head?: number }) {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({ doc, selection, extensions: [formatToolbar(() => LABELS)] }),
    parent,
  });
  const toolbar = view.dom.querySelector<HTMLElement>(".cm-format-toolbar");
  const cleanup = () => {
    view.destroy();
    parent.remove();
  };
  return { view, toolbar, cleanup };
}

describe("formatToolbar", () => {
  it("stays hidden while nothing is selected", () => {
    const { toolbar, cleanup } = mount("foo bar", { anchor: 1 });
    expect(toolbar?.style.visibility).toBe("hidden");
    cleanup();
  });

  it("labels each action for screen readers", () => {
    const { toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    const labels = [...(toolbar?.querySelectorAll("button") ?? [])].map((b) =>
      b.getAttribute("aria-label"),
    );
    expect(labels).toEqual(["Bold", "Italic", "Inline code", "Strikethrough"]);
    cleanup();
  });

  it("wraps the selection when an action is pressed", () => {
    const { view, toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    const bold = toolbar?.querySelector<HTMLButtonElement>('[data-action="bold"]');
    bold?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toBe("**foo** bar");
    cleanup();
  });

  it("hides again once the selection collapses", () => {
    const { view, toolbar, cleanup } = mount("foo bar", { anchor: 0, head: 3 });
    view.dispatch({ selection: { anchor: 2 } });
    expect(toolbar?.style.visibility).toBe("hidden");
    cleanup();
  });
});
