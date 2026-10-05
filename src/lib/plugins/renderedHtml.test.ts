import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareRenderedHtml } from "./renderedHtml";

const AI_REPLY = '<aside><div class="markdown-body"><p>AI reply</p></div></aside>';

function viewer(inner: string, wrapperClass = ""): string {
  return `<div class="${wrapperClass}"><div data-scroll-container="">${inner}</div></div>`;
}

describe("prepareRenderedHtml", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the viewer's document with app-only UI stripped", async () => {
    document.body.innerHTML = viewer(
      '<div class="markdown-body"><p>Hi</p><button>copy</button></div>',
    );
    expect(await prepareRenderedHtml()).toBe("<p>Hi</p>");
  });

  it("keeps an empty document distinct from no document", async () => {
    document.body.innerHTML = viewer('<div class="markdown-body"></div>');
    expect(await prepareRenderedHtml()).toBe("");
  });

  it("picks the document over an AI reply that renders markdown before it", async () => {
    document.body.innerHTML = AI_REPLY + viewer('<div class="markdown-body"><p>Document</p></div>');
    expect(await prepareRenderedHtml()).toBe("<p>Document</p>");
  });

  it("is null when only other markdown is on screen (an editor-only tab)", async () => {
    document.body.innerHTML = AI_REPLY;
    expect(await prepareRenderedHtml()).toBeNull();
  });

  it("is null for a canvas, whose cards render markdown outside a viewer", async () => {
    document.body.innerHTML =
      '<div class="glyph-canvas"><div class="markdown-body"><p>Card</p></div></div>';
    expect(await prepareRenderedHtml()).toBeNull();
  });

  it("takes the preview pane in split view", async () => {
    document.body.innerHTML =
      viewer('<div class="markdown-body"><p>Stale</p></div>') +
      viewer('<div class="markdown-body"><p>Preview</p></div>', "split-view-preview");
    expect(await prepareRenderedHtml()).toBe("<p>Preview</p>");
  });

  it("returns a notebook's body, not its first markdown cell", async () => {
    document.body.innerHTML = viewer(
      '<div class="notebook-body"><div class="markdown-body"><p>Cell</p></div><pre>out</pre></div>',
    );
    expect(await prepareRenderedHtml()).toBe(
      '<div class="markdown-body"><p>Cell</p></div><pre>out</pre>',
    );
  });

  it("returns the document that is active once rendering settles, not the one it began with", async () => {
    document.body.innerHTML = viewer('<div class="markdown-body"><p>First tab</p></div>');
    const pending = prepareRenderedHtml();
    // A tab switch while the render gate is still waiting.
    document.body.innerHTML = viewer('<div class="markdown-body"><p>Second tab</p></div>');

    expect(await pending).toBe("<p>Second tab</p>");
  });

  it("is null when the document closes while rendering settles", async () => {
    vi.useFakeTimers();
    try {
      document.body.innerHTML = viewer('<div class="markdown-body"><p>Closing</p></div>');
      const pending = prepareRenderedHtml();
      document.body.innerHTML = "";
      // With nothing rendered the gate runs to its deadline.
      await vi.advanceTimersByTimeAsync(15_000);

      expect(await pending).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
