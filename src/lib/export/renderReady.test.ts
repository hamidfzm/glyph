import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mirrorDocumentAsset } from "@/lib/documentAssets";
import { trackPluginLoad } from "@/lib/markdown/pluginLoads";
import { AI_REPLY_HTML } from "@/test/fixtures/aiReply";
import { mountDocumentBody as setBody } from "@/test/mountDocumentBody";
import { waitForRenderIdle } from "./renderReady";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("waitForRenderIdle", () => {
  it("settles once a rendered document sits still", async () => {
    setBody("<p>done</p>");
    await expect(waitForRenderIdle(2000)).resolves.toEqual({ settled: true });
  });

  // A document waiting on a lazy chunk mutates nothing, so the quiet check
  // alone would call it finished and export the unrendered shortcode.
  it("waits for a plugin render marked aria-busy", async () => {
    const body = setBody('<div data-fenced-language="d2"><div aria-busy="true"></div></div>');
    const pending = waitForRenderIdle(3000);

    await new Promise((resolve) => setTimeout(resolve, 400));
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    body.querySelector("[aria-busy]")!.setAttribute("aria-busy", "false");
    await expect(pending).resolves.toEqual({ settled: true });
  });

  it("waits for a lazy plugin chunk that is still loading", async () => {
    setBody("<p>shipped :tada:</p>");
    let settle = () => {};
    void trackPluginLoad(
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
    );
    const pending = waitForRenderIdle(3000);

    await new Promise((resolve) => setTimeout(resolve, 400));
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    settle();
    await expect(pending).resolves.toEqual({ settled: true });
  });

  // An image beside a loose file has no src until the backend answers, and
  // setting one changes no child list, so quiet alone would snapshot it empty.
  it("waits for a loose-file asset still waiting on the backend", async () => {
    setBody('<p><img alt="cover"></p>');
    let answer = () => {};
    vi.mocked(invoke).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        answer = resolve;
      }),
    );
    void mirrorDocumentAsset("/notes/cover.png");
    const pending = waitForRenderIdle(3000);

    await new Promise((resolve) => setTimeout(resolve, 400));
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    answer();
    await expect(pending).resolves.toEqual({ settled: true });
  });

  // An AI reply ahead of the viewer is quiet and complete; the document's own
  // pending diagram still has to hold the gate.
  it("waits on the document, not a markdown body rendered ahead of it", async () => {
    document.body.innerHTML = AI_REPLY_HTML;
    setBody('<div data-fenced-language="d2"><div aria-busy="true"></div></div>');
    await expect(waitForRenderIdle(300)).resolves.toEqual({ settled: false });
  });

  // A board is an exportable root in its own right; treating only the document
  // bodies as one made every canvas export wait out the deadline.
  it("settles on a canvas board", async () => {
    const board = document.createElement("div");
    board.className = "glyph-canvas";
    board.innerHTML = '<div class="markdown-body"><p>card</p></div>';
    document.body.appendChild(board);
    await expect(waitForRenderIdle(2000)).resolves.toEqual({ settled: true });
  });

  it("gives up at the deadline so one stuck diagram cannot hang the process", async () => {
    setBody('<div data-fenced-language="mermaid"><div aria-busy="true"></div></div>');
    await expect(waitForRenderIdle(300)).resolves.toEqual({ settled: false });
  });

  it("waits for the document to appear, since a CLI launch opens it after mount", async () => {
    const pending = waitForRenderIdle(3000);
    setTimeout(() => setBody("<p>opened late</p>"), 50);
    await expect(pending).resolves.toEqual({ settled: true });
  });

  it("reports the timeout when no document ever appears", async () => {
    await expect(waitForRenderIdle(300)).resolves.toEqual({ settled: false });
  });
});
