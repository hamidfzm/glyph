import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { pasteHtmlExtension } from "./editorPasteHtml";

function mount(enabled: boolean, doc = "") {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [pasteHtmlExtension(() => enabled)],
    }),
    parent,
  });
  return view;
}

// happy-dom's ClipboardEvent carries no clipboardData, so attach a minimal stub.
function paste(view: EditorView, flavors: Record<string, string>) {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { getData: (type: string) => flavors[type] ?? "" },
  });
  view.contentDOM.dispatchEvent(event);
  return event;
}

describe("pasteHtmlExtension", () => {
  it("inserts the converted markdown at the selection", () => {
    const view = mount(true, "before ");
    const event = paste(view, { "text/html": "<strong>bold</strong>", "text/plain": "bold" });
    expect(event.defaultPrevented).toBe(true);
    expect(view.state.doc.toString()).toBe("before **bold**");
  });

  // In the fallback cases CodeMirror's built-in paste takes over and inserts
  // the plain-text flavor unchanged.
  it("does not convert when the setting is off", () => {
    const view = mount(false);
    paste(view, { "text/html": "<strong>bold</strong>", "text/plain": "bold" });
    expect(view.state.doc.toString()).toBe("bold");
  });

  it("does not convert a plain-text clipboard", () => {
    const view = mount(true);
    paste(view, { "text/plain": "bold" });
    expect(view.state.doc.toString()).toBe("bold");
  });

  it("does not convert HTML that holds no content", () => {
    const view = mount(true);
    paste(view, { "text/html": "<div></div>", "text/plain": "plain" });
    expect(view.state.doc.toString()).toBe("plain");
  });
});
