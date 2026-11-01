import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PreviewOptions, renderPreview } from "./renderPreview";

vi.mock("@/plugins/core/mermaid/mermaidRender", () => ({
  renderMermaidPreview: vi.fn((_source: string, dark: boolean) =>
    Promise.resolve(`<svg data-theme="${dark ? "dark" : "light"}"></svg>`),
  ),
}));
// happy-dom cannot run DOMPurify faithfully; the sanitize wiring is covered
// in staticInline.test.ts.
vi.mock("dompurify", () => ({ default: { sanitize: (markup: string) => markup } }));

const { renderMermaidPreview } = await import("@/plugins/core/mermaid/mermaidRender");

const options: PreviewOptions = { dark: false, images: "https://glyph-document.example/" };

async function render(content: string, overrides: Partial<PreviewOptions> = {}) {
  const { html } = await renderPreview(content, { ...options, ...overrides });
  return html;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderPreview", () => {
  it("renders the frontmatter block above the document", async () => {
    const html = await render("---\ntitle: Notes\n---\n\n# Body\n");
    expect(html).toContain("frontmatter-table");
    expect(html).toContain("Notes");
    expect(html.indexOf("frontmatter-table")).toBeLessThan(html.indexOf("Body"));
  });

  it("renders GFM tables, task lists and alerts", async () => {
    const html = await render(
      ["| a | b |", "| - | - |", "| 1 | 2 |", "", "- [x] done", "", "> [!NOTE]", "> Heads up"].join(
        "\n",
      ),
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("markdown-alert");
  });

  it("highlights code and renders math", async () => {
    const html = await render("```js\nconst a = 1;\n```\n\n$E = mc^2$\n\n$$\nx^2\n$$");
    expect(html).toContain("hljs");
    expect(html).toContain('<span data-math-source="E = mc^2"><span class="katex">');
    expect(html).toContain(
      '<div data-math-source="x^2" data-math-display=""><span class="katex-display">',
    );
  });

  // `A-->B` would read the source back mangled: happy-dom mis-tokenizes `-->`
  // in text. Real engines don't, and neither does the WebView2 the pane uses.
  it("replaces a mermaid block with the diagram in the current theme", async () => {
    const html = await render("```mermaid\nflowchart LR; A --- B;\n```", { dark: true });
    expect(html).toContain('<svg data-theme="dark">');
    expect(html).not.toContain("language-mermaid");
    expect(renderMermaidPreview).toHaveBeenCalledWith("flowchart LR; A --- B;\n", true);
  });

  it("keeps the source block when a diagram fails to render", async () => {
    vi.mocked(renderMermaidPreview).mockRejectedValueOnce(new Error("bad diagram"));
    const html = await render("```mermaid\nnope\n```");
    expect(html).toContain("language-mermaid");
  });

  it("sanitizes raw HTML in the document", async () => {
    const html = await render(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<b>bold</b>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("<b>bold</b>");
  });

  it("routes relative images through the document host", async () => {
    const html = await render("![shot](shot.png)");
    expect(html).toContain('src="https://glyph-document.example/shot.png"');
  });

  it("counts the relative images that became alt text", async () => {
    const content = "![a](a.png) ![b](sub/b.png) ![far](https://example.com/c.png) ![up](../d.png)";
    expect((await renderPreview(content, options)).droppedImages).toBe(0);
    expect((await renderPreview(content, { ...options, images: null })).droppedImages).toBe(2);
    const picked = await renderPreview(content, {
      ...options,
      images: (src) => (src === "a.png" ? "blob:picked-a" : null),
    });
    expect(picked.html).toContain('src="blob:picked-a"');
    expect(picked.droppedImages).toBe(1);
  });

  it("renders a wikilink as unresolved, with no workspace index", async () => {
    const html = await render("[[Some Note]]");
    expect(html).toContain("Some Note");
    expect(html).not.toContain('href="Some Note"');
  });
});
