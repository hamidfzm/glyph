import { afterEach, describe, expect, it, vi } from "vitest";
import { AI_REPLY_HTML } from "@/test/fixtures/aiReply";
import { mountDocumentBody } from "@/test/mountDocumentBody";
import { prepareRenderedHtml } from "./renderedHtml";

describe("prepareRenderedHtml", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("returns the active document with app-only UI stripped", async () => {
    mountDocumentBody("<p>Hi</p><button>copy</button>");
    expect(await prepareRenderedHtml()).toBe("<p>Hi</p>");
  });

  it("keeps an empty document distinct from no document", async () => {
    mountDocumentBody("");
    expect(await prepareRenderedHtml()).toBe("");
  });

  it("is null when the only markdown on screen is not a document", async () => {
    document.body.innerHTML = AI_REPLY_HTML;
    expect(await prepareRenderedHtml()).toBeNull();
  });

  it("returns the document that is active once rendering settles, not the one it began with", async () => {
    mountDocumentBody("<p>First tab</p>");
    const pending = prepareRenderedHtml();
    // A tab switch while the render gate is still waiting.
    document.body.innerHTML = "";
    mountDocumentBody("<p>Second tab</p>");

    expect(await pending).toBe("<p>Second tab</p>");
  });

  it("is null when the document closes while rendering settles", async () => {
    vi.useFakeTimers();
    try {
      mountDocumentBody("<p>Closing</p>");
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
