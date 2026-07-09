import { describe, expect, it } from "vitest";
import { renderPageHtml } from "./renderPage";

const FILE = "/ws/notes.md";
const FILES = ["/ws/notes.md", "/ws/other.md"];

function render(content: string) {
  return renderPageHtml({ content, filePath: FILE, workspaceFiles: FILES });
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

  it("renders math through KaTeX", async () => {
    const html = await render("Euler: $e^{i\\pi} = -1$");
    expect(html).toContain("katex");
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
});
