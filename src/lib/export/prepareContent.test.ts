import { afterEach, describe, expect, it, vi } from "vitest";
import type { TocEntry } from "@/hooks/useTableOfContents";
import { prepareContent } from "./prepareContent";

// Rendering needs a real layout/canvas/WASM engine; mock the helpers so the
// orchestration is testable without them.
const rasterizeElementMock = vi.fn(async () => "data:image/png;base64,MATH");
const renderMermaidMock = vi.fn(async () => '<svg data-diagram="mermaid-light"></svg>');
const renderD2Mock = vi.fn(async () => '<svg data-diagram="d2-light"></svg>');
const restoreMermaidMock = vi.fn(async () => {});
vi.mock("./rasterize", () => ({
  rasterizeElement: () => rasterizeElementMock(),
  renderMermaidLightSvg: () => renderMermaidMock(),
  restoreMermaidTheme: () => restoreMermaidMock(),
}));
vi.mock("@/lib/d2Render", () => ({
  renderD2: () => renderD2Mock(),
}));
// DOMPurify does not run faithfully under happy-dom (it drops the <svg>
// wrapper), so mock it pass-through and assert the sanitize wiring instead;
// real stripping is DOMPurify's job in the webview.
const sanitizeMock = vi.fn((svg: string, _opts?: { FORBID_TAGS?: string[] }) => svg);
vi.mock("dompurify", () => ({
  default: {
    sanitize: (svg: string, opts?: { FORBID_TAGS?: string[] }) => sanitizeMock(svg, opts),
  },
}));

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
      '<pre style="background-color: rgb(40, 42, 54)"><code style="color: rgb(248, 248, 242)">' +
        '<span style="color: rgb(255,0,0)">kw</span> x</code></pre>' +
        "<pre>raw block</pre>",
    );
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    // Token color preserved, and the block background comes from <pre> (not the
    // transparent <code>) so dark code themes get a dark box, not a light one.
    expect(result?.html).toContain("rgb(255, 0, 0)");
    expect(result?.html).toContain("rgb(40, 42, 54)");
  });

  it("rasterizes block math and swaps Mermaid for its light vector SVG for PDF", async () => {
    rasterizeElementMock.mockClear();
    renderMermaidMock.mockClear();
    restoreMermaidMock.mockClear();
    setBody(
      '<p><span class="katex-display">math</span></p>' +
        '<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg></svg></div>',
    );
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(rasterizeElementMock).toHaveBeenCalledTimes(1); // block math stays raster
    expect(renderMermaidMock).toHaveBeenCalledTimes(1); // diagram re-rendered light
    expect(restoreMermaidMock).toHaveBeenCalledTimes(1); // app theme restored after
    expect(result?.html).toContain("data:image/png;base64,MATH");
    expect(result?.html).toContain('data-diagram="mermaid-light"'); // inline vector SVG, not a PNG
    expect(result?.html).not.toContain("katex-display");
    expect(result?.html).not.toContain("mermaid-diagram");
  });

  it("swaps a D2 diagram for its light vector SVG for PDF", async () => {
    renderD2Mock.mockClear();
    setBody('<div class="d2-diagram" data-d2-source="a -> b"><svg></svg></div>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(renderD2Mock).toHaveBeenCalledTimes(1);
    expect(result?.html).toContain('data-diagram="d2-light"');
    expect(result?.html).not.toContain("d2-diagram");
    expect(result?.html).not.toContain("data:image/png");
  });

  it("leaves a D2 diagram untouched when its source is missing", async () => {
    renderD2Mock.mockClear();
    setBody('<div class="d2-diagram"><svg></svg></div>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(renderD2Mock).not.toHaveBeenCalled();
    expect(result?.html).toContain("d2-diagram");
  });

  it("leaves a Mermaid diagram untouched when its source is missing", async () => {
    renderMermaidMock.mockClear();
    setBody('<div class="mermaid-diagram"><svg></svg></div>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(renderMermaidMock).not.toHaveBeenCalled();
    expect(result?.html).toContain("mermaid-diagram");
  });

  it("keeps the original node when math rasterization fails", async () => {
    rasterizeElementMock.mockClear();
    rasterizeElementMock.mockRejectedValueOnce(new Error("canvas tainted"));
    setBody('<span class="katex-display">E=mc^2</span>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    // Fallback: the math element survives (the walker turns it into LaTeX text).
    expect(result?.html).toContain("katex-display");
    expect(result?.html).not.toContain("data:image/png");
  });

  it("sanitizes the re-rendered diagram SVG before it re-enters the DOM", async () => {
    sanitizeMock.mockClear();
    setBody(
      '<div class="mermaid-diagram" data-mermaid-source="graph TD; A-->B"><svg></svg></div>' +
        '<div class="d2-diagram" data-d2-source="a -> b"><svg></svg></div>',
    );
    await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(sanitizeMock).toHaveBeenCalledTimes(2);
    for (const call of sanitizeMock.mock.calls) {
      expect(call[1]).toEqual({ FORBID_TAGS: ["foreignObject"] });
    }
  });

  it("drops a diagram whose light re-render fails (never embeds the dark SVG)", async () => {
    renderMermaidMock.mockClear();
    renderMermaidMock.mockRejectedValueOnce(new Error("bad source"));
    setBody(
      '<div class="mermaid-diagram" data-mermaid-source="broken"><svg data-dark="1"></svg></div>' +
        "<p>after</p>",
    );
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(result?.html).not.toContain("mermaid-diagram");
    expect(result?.html).not.toContain('data-dark="1"');
    expect(result?.html).toContain("after");
  });

  it("drops a diagram whose light render returns no svg", async () => {
    renderD2Mock.mockResolvedValueOnce("plain text, not svg");
    setBody('<div class="d2-diagram" data-d2-source="a -> b"><svg data-dark="1"></svg></div>');
    const result = await prepareContent({ entries: ENTRIES, includeToc: false, pdf: true });
    expect(result?.html).not.toContain("d2-diagram");
    expect(result?.html).not.toContain('data-dark="1"');
  });

  it("does not touch math or diagrams for non-PDF exports", async () => {
    rasterizeElementMock.mockClear();
    renderMermaidMock.mockClear();
    setBody('<span class="katex-display">math</span>');
    await prepareContent({ entries: ENTRIES, includeToc: false });
    expect(rasterizeElementMock).not.toHaveBeenCalled();
    expect(renderMermaidMock).not.toHaveBeenCalled();
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
