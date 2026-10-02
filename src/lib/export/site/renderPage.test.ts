import { describe, expect, it, vi } from "vitest";
import type { LazyMarkdownPlugin, MarkdownPlugin } from "@/lib/plugins/types";
import { renderPageHtml } from "./renderPage";

// What the index answered for this page's wikilink targets; `missing` is absent
// on purpose, which is how a broken link reaches the renderer.
const RESOLUTIONS = new Map([["other", "/ws/other.md"]]);

function render(content: string) {
  return renderPageHtml({ content, resolutions: RESOLUTIONS });
}

describe("renderPageHtml", () => {
  it("renders GFM tables and strikethrough", async () => {
    const html = await render("| a | b |\n| - | - |\n| 1 | 2 |\n\n~~gone~~");
    expect(html).toContain("<table>");
    expect(html).toContain("<del>gone</del>");
  });

  it("gives headings slug ids like the live viewer", async () => {
    const html = await render("# Getting Started");
    expect(html).toContain('<h1 id="getting-started">');
  });

  it("leaves math as text without a math plugin", async () => {
    const html = await render("Euler: $e = 1$");
    expect(html).toContain("$e = 1$");
    expect(html).not.toContain("katex");
  });

  it("loads a lazy rehype contribution only for a page that needs it", async () => {
    const stamp = () => (tree: { children: { properties?: Record<string, unknown> }[] }) => {
      for (const node of tree.children) node.properties = { ...node.properties, dataStamped: "" };
    };
    const lazy: LazyMarkdownPlugin = {
      detect: (markdown) => markdown.includes("!!"),
      load: vi.fn(async () => stamp as MarkdownPlugin),
    };
    const plain = await renderPageHtml({
      content: "plain",
      resolutions: RESOLUTIONS,
      extraRehype: [lazy],
    });
    expect(lazy.load).not.toHaveBeenCalled();
    expect(plain).not.toContain("data-stamped");

    const needed = await renderPageHtml({
      content: "!! go",
      resolutions: RESOLUTIONS,
      extraRehype: [lazy],
    });
    expect(lazy.load).toHaveBeenCalledTimes(1);
    expect(needed).toContain("data-stamped");
  });

  it("renders emoji shortcodes through gemoji", async () => {
    const html = await render("shipped :tada:");
    expect(html).toContain("🎉");
  });

  it("renders GitHub blockquote alerts", async () => {
    const html = await render("> [!NOTE]\n> Heads up");
    expect(html).toContain("markdown-alert");
  });

  it("strips raw HTML that the sanitize schema rejects", async () => {
    const html = await render('hello <script>alert("x")</script> world');
    expect(html).not.toContain("<script>");
  });

  it("keeps allowlisted raw HTML like <kbd>", async () => {
    const html = await render("Press <kbd>Ctrl</kbd>");
    expect(html).toContain("<kbd>Ctrl</kbd>");
  });

  it("highlights fenced code but leaves mermaid as plain source", async () => {
    const html = await render("```js\nconst x = 1;\n```\n\n```mermaid\ngraph TD; A-->B;\n```");
    expect(html).toContain("hljs");
    expect(html).toContain('class="language-mermaid"');
    expect(html).not.toContain("language-mermaid hljs");
  });

  it("emits wikilink anchors with the resolver's data attributes", async () => {
    const html = await render("See [[other]] and [[missing]]");
    expect(html).toContain('data-wikilink-path="/ws/other.md"');
    expect(html).toContain("data-wikilink-broken");
  });

  it("strips frontmatter from the rendered body", async () => {
    const html = await render("---\ntitle: T\n---\n\nBody");
    expect(html).not.toContain("title: T");
    expect(html).toContain("<p>Body</p>");
  });

  it("runs plugin-contributed remark plugins after the built-ins", async () => {
    interface Node {
      type: string;
      value?: string;
      children?: Node[];
    }
    // A minimal remark plugin that upper-cases every text node.
    const shout = () => (tree: Node) => {
      const visit = (node: Node) => {
        if (node.type === "text" && node.value) node.value = node.value.toUpperCase();
        for (const child of node.children ?? []) visit(child);
      };
      visit(tree);
    };
    const html = await renderPageHtml({
      content: "quiet words",
      resolutions: RESOLUTIONS,
      extraRemark: [shout as MarkdownPlugin],
    });
    expect(html).toContain("QUIET WORDS");
  });
});
