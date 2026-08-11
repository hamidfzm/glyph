import { afterEach, describe, expect, it } from "vitest";
import { waitForRenderIdle } from "./renderReady";

function setBody(html: string): HTMLElement {
  const body = document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = html;
  document.body.appendChild(body);
  return body;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("waitForRenderIdle", () => {
  it("settles once a rendered document sits still", async () => {
    setBody("<p>done</p>");
    await expect(waitForRenderIdle(document, 2000)).resolves.toEqual({ settled: true });
  });

  it("waits for an empty diagram container to be filled", async () => {
    const body = setBody(
      '<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"></div>',
    );
    const pending = waitForRenderIdle(document, 3000);

    // Still empty after the quiet window: the exporter must not proceed.
    await new Promise((resolve) => setTimeout(resolve, 400));
    let done = false;
    void pending.then(() => {
      done = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(done).toBe(false);

    body.querySelector(".mermaid-diagram")!.innerHTML = "<svg></svg>";
    await expect(pending).resolves.toEqual({ settled: true });
  });

  it("gives up at the deadline so one stuck diagram cannot hang the process", async () => {
    setBody('<div class="d2-diagram" data-d2-source="a -> b"></div>');
    await expect(waitForRenderIdle(document, 300)).resolves.toEqual({ settled: false });
  });

  it("waits for the document to appear, since a CLI launch opens it after mount", async () => {
    const pending = waitForRenderIdle(document, 3000);
    setTimeout(() => setBody("<p>opened late</p>"), 50);
    await expect(pending).resolves.toEqual({ settled: true });
  });

  it("reports the timeout when no document ever appears", async () => {
    await expect(waitForRenderIdle(document, 300)).resolves.toEqual({ settled: false });
  });
});
