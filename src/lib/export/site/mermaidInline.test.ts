import { describe, expect, it, vi } from "vitest";
import { inlineMermaidSvgs } from "./mermaidInline";

const PAGE = '<h1>t</h1><pre><code class="language-mermaid">graph TD; A--&gt;B;</code></pre>';

describe("inlineMermaidSvgs", () => {
  it("replaces mermaid code blocks with the rendered SVG", async () => {
    const render = vi.fn().mockResolvedValue("<svg><g>diagram</g></svg>");
    const out = await inlineMermaidSvgs(PAGE, render);
    expect(render).toHaveBeenCalledWith("graph TD; A-->B;");
    expect(out).toContain('<div class="mermaid-diagram"><svg><g>diagram</g></svg></div>');
    expect(out).not.toContain("language-mermaid");
  });

  it("keeps the source block when rendering fails", async () => {
    const render = vi.fn().mockRejectedValue(new Error("bad diagram"));
    const out = await inlineMermaidSvgs(PAGE, render);
    expect(out).toContain("language-mermaid");
  });

  it("returns the input unchanged when there is no mermaid block", async () => {
    const render = vi.fn();
    const html = "<p>plain</p>";
    expect(await inlineMermaidSvgs(html, render)).toBe(html);
    expect(render).not.toHaveBeenCalled();
  });

  it("leaves highlighted non-mermaid code blocks alone", async () => {
    const html = '<pre><code class="language-js hljs">const a = 1;</code></pre>';
    const render = vi.fn().mockResolvedValue("<svg/>");
    expect(await inlineMermaidSvgs(html, render)).toBe(html);
  });
});
