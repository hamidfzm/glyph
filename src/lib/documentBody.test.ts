import { afterEach, describe, expect, it } from "vitest";
import { AI_REPLY_HTML } from "@/test/fixtures/aiReply";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { documentBody } from "./documentBody";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("documentBody", () => {
  it("returns the viewer's markdown body", () => {
    const body = mountDocumentBody("<p>Document</p>");
    expect(documentBody()).toBe(body);
  });

  it("is null when nothing is rendered", () => {
    expect(documentBody()).toBeNull();
  });

  it("is null in an editor-only tab, where the only markdown body is an AI reply", () => {
    document.body.innerHTML = `<div class="cm-editor"></div>${AI_REPLY_HTML}`;
    expect(documentBody()).toBeNull();
  });

  it("is null for a canvas, whose cards render markdown outside a viewer", () => {
    document.body.innerHTML =
      '<div class="glyph-canvas"><div class="glyph-canvas-node-text markdown-body"><p>Card</p></div></div>';
    expect(documentBody()).toBeNull();
  });

  it("picks the document over a markdown body rendered ahead of it", () => {
    document.body.innerHTML = AI_REPLY_HTML;
    const body = mountDocumentBody("<p>Document</p>");
    expect(documentBody()).toBe(body);
  });

  it("returns the notebook body, not the first cell inside it", () => {
    const body = mountDocumentBody(
      '<div class="nb-cell nb-cell-markdown markdown-body"><p>Cell</p></div>',
      "notebook-body",
    );
    expect(documentBody()).toBe(body);
  });

  it("prefers the preview pane of a split layout over its source pane", () => {
    document.body.innerHTML = `
      <div data-scroll-container=""><div class="markdown-body"><p>Source</p></div></div>
      <div class="split-view-preview">
        <div data-scroll-container=""><div class="notebook-body"><p>Preview</p></div></div>
      </div>`;
    expect(documentBody()?.textContent).toBe("Preview");
  });

  it("is null while the viewer's scroller holds no body yet", () => {
    document.body.innerHTML = '<div data-scroll-container=""></div>';
    expect(documentBody()).toBeNull();
  });
});
