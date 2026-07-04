import { describe, expect, it } from "vitest";
import { renderPageHtml } from "./renderPage";
import { rehypeSiteUrls, type SiteUrlContext } from "./rewriteUrls";

// Exercised through the real pipeline: the plugin runs after sanitize on the
// same hast shapes it sees in production.

const ROOT = "/ws";
const FILES = ["/ws/guide/intro.md", "/ws/other.md", "/ws/README.md"];
const PAGES = new Map([
  ["/ws/guide/intro.md", "guide/intro.html"],
  ["/ws/other.md", "other.html"],
  ["/ws/README.md", "index.html"],
]);

function makeCtx(filePath: string, pageRel: string): SiteUrlContext {
  return { filePath, pageRel, root: ROOT, pages: PAGES, assets: new Map() };
}

function render(content: string, ctx: SiteUrlContext) {
  return renderPageHtml({
    content,
    filePath: ctx.filePath,
    workspaceFiles: FILES,
    extraRehype: [[rehypeSiteUrls, ctx]],
  });
}

describe("rehypeSiteUrls links", () => {
  it("rewrites a wikilink to the target's page, relative to the current page", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("See [[other]]", ctx);
    expect(html).toContain('href="../other.html"');
  });

  it("appends the slugged heading fragment from [[page#Heading]]", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("See [[intro#Getting Started]]", ctx);
    expect(html).toContain('href="guide/intro.html#getting-started"');
  });

  it("keeps the alias text and wikilink class", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("See [[intro|the guide]]", ctx);
    expect(html).toContain(">the guide</a>");
    expect(html).toContain("wikilink");
  });

  it("leaves broken wikilinks pointing at # with the broken class", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("See [[nope]]", ctx);
    expect(html).toContain("wikilink--broken");
    expect(html).toContain('href="#"');
  });

  it("rewrites relative markdown links to the generated page", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("Back to [readme](../README.md)", ctx);
    expect(html).toContain('href="../index.html"');
  });

  it("preserves fragments on relative markdown links", async () => {
    const ctx = makeCtx("/ws/README.md", "index.html");
    const html = await render("See [section](other.md#setup)", ctx);
    expect(html).toContain('href="other.html#setup"');
  });

  it("leaves external and in-page links untouched", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[ext](https://example.com) [top](#top)", ctx);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('href="#top"');
  });

  it("leaves relative links that escape the workspace untouched", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[out](../outside/x.md)", ctx);
    expect(html).toContain('href="../outside/x.md"');
  });

  it("leaves a wikilink at # when its target has no generated page", async () => {
    // The resolver knows the file (it is in workspaceFiles) but the export
    // produced no page for it.
    const ctx: SiteUrlContext = {
      ...makeCtx("/ws/other.md", "other.html"),
      pages: new Map([["/ws/other.md", "other.html"]]),
    };
    const html = await render("See [[intro]]", ctx);
    expect(html).toContain('href="#"');
  });

  it("matches pages case-insensitively when link casing differs from disk", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("Back to [readme](../readme.md)", ctx);
    expect(html).toContain('href="../index.html"');
  });

  it("leaves relative links to non-markdown files untouched", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[raw data](./data.csv)", ctx);
    expect(html).toContain('href="./data.csv"');
  });

  it("ignores anchors without an href", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("raw <a>plain anchor</a> text", ctx);
    expect(html).toContain("<a>plain anchor</a>");
  });

  it("skips element nodes that carry no properties at all", () => {
    const transform = rehypeSiteUrls(makeCtx("/ws/other.md", "other.html"));
    const bareAnchor = { type: "element", tagName: "a", children: [] };
    const tree = { type: "root", children: [bareAnchor] };
    expect(() => transform(tree as never)).not.toThrow();
  });
});

describe("rehypeSiteUrls images", () => {
  it("maps an in-workspace image to its mirrored location and records the copy", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("![shot](./img/shot.png)", ctx);
    expect(html).toContain('src="img/shot.png"');
    expect(ctx.assets.get("/ws/guide/img/shot.png")).toBe("guide/img/shot.png");
  });

  it("sends out-of-workspace images to assets/ and dedupes name collisions", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    ctx.assets.set("/elsewhere/pic.png", "assets/pic.png");
    const html = await render("![p](../away/pic.png)", ctx);
    expect(html).toContain('src="assets/pic-1.png"');
    expect(ctx.assets.get("/away/pic.png")).toBe("assets/pic-1.png");
  });

  it("reuses one destination when the same image appears twice", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    await render("![a](./p.png) and ![b](./p.png)", ctx);
    expect(ctx.assets.size).toBe(1);
  });

  it("leaves remote and data images untouched", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("![r](https://example.com/x.png)", ctx);
    expect(html).toContain('src="https://example.com/x.png"');
    expect(ctx.assets.size).toBe(0);
  });

  it("ignores images without a src", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render('raw <img alt="empty"> tag', ctx);
    expect(html).toContain('alt="empty"');
    expect(ctx.assets.size).toBe(0);
  });

  it("percent-encodes spaces in rewritten srcs", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("![s](<./my pics/a b.png>)", ctx);
    expect(html).toContain('src="my%20pics/a%20b.png"');
  });
});
