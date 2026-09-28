import { describe, expect, it, vi } from "vitest";
import { inlineStaticRenders } from "./staticInline";

// happy-dom cannot run DOMPurify faithfully; assert the wiring instead.
const sanitize = vi.hoisted(() => vi.fn((markup: string, _opts?: unknown) => markup));
vi.mock("dompurify", () => ({ default: { sanitize } }));

const PAGE = '<h1>t</h1><pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';

describe("inlineStaticRenders", () => {
  it("replaces a block with its language's static render, sanitized", async () => {
    const render = vi.fn().mockResolvedValue('<div class="mermaid-diagram"><svg></svg></div>');
    const renderFor = vi.fn((language: string) => (language === "mermaid" ? render : undefined));
    const out = await inlineStaticRenders(PAGE, renderFor);
    expect(render).toHaveBeenCalledWith("graph TD; A-->B;");
    expect(out).toContain(
      '<div data-fenced-language="mermaid"><div class="mermaid-diagram"><svg></svg></div></div>',
    );
    expect(out).not.toContain("language-mermaid");
    expect(sanitize.mock.calls[0][1]).toEqual({ FORBID_TAGS: ["foreignObject"] });
  });

  it("drops image references other than data: URLs from the render", async () => {
    const markup =
      '<svg><image href="/Users/me/icon.svg"></image><image href="data:image/png;base64,AA"></image></svg>' +
      '<img src="https://tracker.example/x.png">';
    const out = await inlineStaticRenders(PAGE, () => async () => markup);
    expect(out).not.toContain("/Users/me");
    expect(out).not.toContain("tracker.example");
    expect(out).toContain("data:image/png;base64,AA");
  });

  it("keeps a failed block's source while inlining the others", async () => {
    const page = `${PAGE}<pre><code class="language-mermaid">broken</code></pre>`;
    const render = vi.fn(async (code: string) => {
      if (code === "broken") throw new Error("bad diagram");
      return "<svg></svg>";
    });
    const out = await inlineStaticRenders(page, () => render);
    expect(out).toContain('<div data-fenced-language="mermaid"><svg></svg></div>');
    expect(out).toContain('<code class="language-mermaid">broken</code>');
  });

  it("keeps the source block when rendering fails", async () => {
    const render = vi.fn().mockRejectedValue(new Error("bad diagram"));
    const out = await inlineStaticRenders(PAGE, () => render);
    expect(out).toContain("language-mermaid");
  });

  it("leaves the block as code when no plugin renders its language", async () => {
    const out = await inlineStaticRenders(PAGE, () => undefined);
    expect(out).toBe(PAGE);
  });

  it("returns the input unchanged when there is no fenced block", async () => {
    const renderFor = vi.fn();
    const html = "<p>plain</p>";
    expect(await inlineStaticRenders(html, renderFor)).toBe(html);
    expect(renderFor).not.toHaveBeenCalled();
  });

  it("skips a code block with no language", async () => {
    const html = "<pre><code>plain</code></pre>";
    const renderFor = vi.fn();
    expect(await inlineStaticRenders(html, renderFor)).toBe(html);
    expect(renderFor).not.toHaveBeenCalled();
  });

  it("leaves highlighted code blocks of other languages alone", async () => {
    const html = '<pre><code class="hljs language-js">const a = 1;</code></pre>';
    const renderFor = vi.fn(() => undefined);
    expect(await inlineStaticRenders(html, renderFor)).toBe(html);
    expect(renderFor).toHaveBeenCalledWith("js");
  });
});
