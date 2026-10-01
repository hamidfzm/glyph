import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderPreview } from "./renderPreview";

vi.mock("@/plugins/core/mermaid/mermaidRender", () => ({
  renderMermaidPreview: vi.fn((_source: string, dark: boolean) =>
    Promise.resolve(`<svg data-theme="${dark ? "dark" : "light"}"></svg>`),
  ),
}));
// happy-dom cannot run DOMPurify faithfully; the sanitize wiring is covered
// in staticInline.test.ts.
vi.mock("dompurify", () => ({ default: { sanitize: (markup: string) => markup } }));

const { renderMermaidPreview } = await import("@/plugins/core/mermaid/mermaidRender");

const options = { dark: false, baseUrl: "https://glyph-document.example/" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderPreview", () => {
  it("renders the frontmatter block above the document", async () => {
    const html = await renderPreview("---\ntitle: Notes\n---\n\n# Body\n", options);
    expect(html).toContain("frontmatter-table");
    expect(html).toContain("Notes");
    expect(html.indexOf("frontmatter-table")).toBeLessThan(html.indexOf("Body"));
  });

  it("renders GFM tables, task lists and alerts", async () => {
    const html = await renderPreview(
      ["| a | b |", "| - | - |", "| 1 | 2 |", "", "- [x] done", "", "> [!NOTE]", "> Heads up"].join(
        "\n",
      ),
      options,
    );
    expect(html).toContain("<table>");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("markdown-alert");
  });

  it("highlights code and renders math", async () => {
    const html = await renderPreview(
      "```js\nconst a = 1;\n```\n\n$E = mc^2$\n\n$$\nx^2\n$$",
      options,
    );
    expect(html).toContain("hljs");
    expect(html).toContain('<span data-math-source="E = mc^2"><span class="katex">');
    expect(html).toContain(
      '<div data-math-source="x^2" data-math-display=""><span class="katex-display">',
    );
  });

  // `A-->B` would read the source back mangled: happy-dom mis-tokenizes `-->`
  // in text. Real engines don't, and neither does the WebView2 the pane uses.
  it("replaces a mermaid block with the diagram in the current theme", async () => {
    const html = await renderPreview("```mermaid\nflowchart LR; A --- B;\n```", {
      ...options,
      dark: true,
    });
    expect(html).toContain('<svg data-theme="dark">');
    expect(html).not.toContain("language-mermaid");
    expect(renderMermaidPreview).toHaveBeenCalledWith("flowchart LR; A --- B;\n", true);
  });

  it("keeps the source block when a diagram fails to render", async () => {
    vi.mocked(renderMermaidPreview).mockRejectedValueOnce(new Error("bad diagram"));
    const html = await renderPreview("```mermaid\nnope\n```", options);
    expect(html).toContain("language-mermaid");
  });

  it("sanitizes raw HTML in the document", async () => {
    const html = await renderPreview(
      '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n<b>bold</b>',
      options,
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("onerror");
    expect(html).toContain("<b>bold</b>");
  });

  it("routes relative images through the document host", async () => {
    const html = await renderPreview("![shot](shot.png)", options);
    expect(html).toContain('src="https://glyph-document.example/shot.png"');
  });

  it("renders a wikilink as unresolved, with no workspace index", async () => {
    const html = await renderPreview("[[Some Note]]", options);
    expect(html).toContain("Some Note");
    expect(html).not.toContain('href="Some Note"');
  });
});
