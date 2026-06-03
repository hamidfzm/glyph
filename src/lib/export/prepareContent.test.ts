import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { prepareContent } from "./prepareContent";

// html2canvas needs a real layout engine; mock it so the rasterization
// orchestration is testable without it.
const html2canvasMock = vi.fn(async () => ({ toDataURL: () => "data:image/png;base64,RASTER" }));
vi.mock("html2canvas", () => ({ default: () => html2canvasMock() }));

const ENTRIES: TocEntry[] = [{ id: "intro", text: "Intro", level: 1 }];

function setBody(html: string, className = "markdown-body"): void {
  const body = document.createElement("div");
  body.className = className;
  body.innerHTML = html;
  document.body.appendChild(body);
}

// Most assertions only care about the produced HTML.
async function prepareHtml(includeToc = false): Promise<string | null> {
  const result = await prepareContent({ entries: ENTRIES, includeToc });
  return result?.html ?? null;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("prepareContent", () => {
  it("returns null when there is no rendered body", async () => {
    expect(await prepareContent({ entries: ENTRIES, includeToc: false })).toBeNull();
  });

  it("reports the markdown body class", async () => {
    setBody("<p>x</p>");
    expect((await prepareContent({ entries: ENTRIES, includeToc: false }))?.bodyClass).toBe(
      "markdown-body",
    );
  });

  it("reads notebook bodies and reports the notebook class", async () => {
    setBody("<div class='nb-cell'>cell</div>", "notebook-body");
    const result = await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(result?.bodyClass).toBe("notebook-body");
    expect(result?.html).toContain("cell");
  });

  it("strips copy buttons and export-ignored elements", async () => {
    setBody(
      `<div class="code-block-wrapper"><button class="code-copy-button">copy</button><pre>code</pre></div>` +
        `<div data-export-ignore="true">hidden</div><p>keep</p>`,
    );
    const html = await prepareHtml();
    expect(html).not.toContain("code-copy-button");
    expect(html).not.toContain("hidden");
    expect(html).toContain("<pre>code</pre>");
    expect(html).toContain("keep");
  });

  it("disables task-list checkboxes so exports aren't interactive", async () => {
    setBody(
      `<ul class="contains-task-list"><li class="task-list-item">` +
        `<input type="checkbox" checked> done</li></ul>`,
    );
    const html = await prepareHtml();
    expect(html).toContain("disabled");
    // The checked state is preserved, only the interactivity is removed.
    expect(html).toContain("checked");
  });

  it("opens external links in a new tab but leaves in-page links alone", async () => {
    setBody(
      `<a href="https://example.com">ext</a>` +
        `<a href="#section">jump</a>` +
        `<a href="./other.md">rel</a>`,
    );
    const html = await prepareHtml();
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    // The in-page anchor is untouched.
    expect(html).toMatch(/<a href="#section"[^>]*>jump<\/a>/);
  });

  it("inlines code token colors when requested (PDF)", async () => {
    // Inline styles are reflected by getComputedStyle, so the copy is observable.
    // The second <pre> has no <code>, exercising that fallback.
    setBody(
      '<pre><code><span style="color: rgb(255,0,0)">kw</span> x</code></pre>' +
        "<pre>raw block</pre>",
    );
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(result?.html).toContain("rgb(255, 0, 0)");
  });

  it("rasterizes block math and Mermaid diagrams to images for PDF", async () => {
    html2canvasMock.mockClear();
    setBody(
      '<p><span class="katex-display">math</span></p><div class="mermaid-diagram"><svg></svg></div>',
    );
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(html2canvasMock).toHaveBeenCalledTimes(2);
    expect(result?.html).toContain("data:image/png;base64,RASTER");
    // The original rich nodes are replaced by the rasterized images.
    expect(result?.html).not.toContain("katex-display");
    expect(result?.html).not.toContain("mermaid-diagram");
  });

  it("keeps the original node when rasterization fails", async () => {
    html2canvasMock.mockClear();
    html2canvasMock.mockRejectedValueOnce(new Error("canvas tainted"));
    setBody('<span class="katex-display">E=mc^2</span>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    // Fallback: the math element survives (the walker turns it into LaTeX text).
    expect(result?.html).toContain("katex-display");
    expect(result?.html).not.toContain("data:image/png");
  });

  it("does not rasterize for non-PDF exports", async () => {
    html2canvasMock.mockClear();
    setBody('<span class="katex-display">math</span>');
    await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(html2canvasMock).not.toHaveBeenCalled();
  });

  it("injects a table of contents when requested", async () => {
    setBody("<h1>Intro</h1>");
    const html = await prepareHtml(true);
    expect(html).toContain('class="print-toc"');
    expect(html).toContain('href="#intro"');
  });

  it("omits the toc when includeToc is false", async () => {
    setBody("<h1>Intro</h1>");
    expect(await prepareHtml(false)).not.toContain("print-toc");
  });

  it("leaves already-inlined data URIs untouched", async () => {
    setBody(`<img src="data:image/png;base64,AAAA" alt="x">`);
    expect(await prepareHtml()).toContain("data:image/png;base64,AAAA");
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
    const html = await prepareHtml();
    expect(html).toContain("data:image/png;base64,");
    expect(html).not.toContain("https://example.com/pic.png");
  });

  it("leaves the original src when the fetch is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    setBody(`<img src="https://example.com/missing.png">`);
    expect(await prepareHtml()).toContain("https://example.com/missing.png");
  });

  it("leaves the original src when the fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network");
      }),
    );
    setBody(`<img src="https://example.com/err.png">`);
    expect(await prepareHtml()).toContain("https://example.com/err.png");
  });
});
