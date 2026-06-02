import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { prepareContent } from "./prepareContent";

const ENTRIES: TocEntry[] = [{ id: "intro", text: "Intro", level: 1 }];

function setBody(html: string): void {
  const body = document.createElement("div");
  body.className = "markdown-body";
  body.innerHTML = html;
  document.body.appendChild(body);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("prepareContent", () => {
  it("returns null when there is no rendered body", async () => {
    expect(await prepareContent({ entries: ENTRIES, includeToc: false })).toBeNull();
  });

  it("strips copy buttons and export-ignored elements", async () => {
    setBody(
      `<div class="code-block-wrapper"><button class="code-copy-button">copy</button><pre>code</pre></div>` +
        `<div data-export-ignore="true">hidden</div><p>keep</p>`,
    );
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).not.toContain("code-copy-button");
    expect(html).not.toContain("hidden");
    expect(html).toContain("<pre>code</pre>");
    expect(html).toContain("keep");
  });

  it("injects a table of contents when requested", async () => {
    setBody("<h1>Intro</h1>");
    const html = await prepareContent({ entries: ENTRIES, includeToc: true });
    expect(html).toContain('class="print-toc"');
    expect(html).toContain('href="#intro"');
  });

  it("omits the toc when includeToc is false", async () => {
    setBody("<h1>Intro</h1>");
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).not.toContain("print-toc");
  });

  it("leaves already-inlined data URIs untouched", async () => {
    setBody(`<img src="data:image/png;base64,AAAA" alt="x">`);
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  it("inlines fetched images as data URIs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        blob: async () => new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }),
      })),
    );
    setBody(`<img src="https://example.com/pic.png" alt="x">`);
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("https://example.com/pic.png");
  });

  it("leaves the original src when the fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    setBody(`<img src="https://example.com/missing.png">`);
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).toContain("https://example.com/missing.png");
  });

  it("leaves the original src when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    setBody(`<img src="https://example.com/err.png">`);
    const html = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html).toContain("https://example.com/err.png");
  });
});
