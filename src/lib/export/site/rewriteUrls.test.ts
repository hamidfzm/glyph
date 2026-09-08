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

  it("copies a linked non-markdown file and points the link at the copy", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("[the report](./report.pdf)", ctx);
    expect(html).toContain('href="report.pdf"');
    expect(ctx.assets.get("/ws/guide/report.pdf")).toBe("guide/report.pdf");
  });

  it("keeps the fragment on a linked non-markdown file", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[page 3](./report.pdf#page=3)", ctx);
    expect(html).toContain('href="report.pdf#page=3"');
  });

  it("leaves a linked file above the workspace alone rather than publishing it", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[secret](../private/notes.pdf)", ctx);
    expect(html).toContain('href="../private/notes.pdf"');
    expect(ctx.assets.size).toBe(0);
  });

  it("shares one copy between a link and an image pointing at the same file", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("![p](./pic.png) and [p](./pic.png)", ctx);
    expect(html).toContain('href="pic.png"');
    expect(html).toContain('src="pic.png"');
    expect(ctx.assets.size).toBe(1);
  });

  it("keeps a query string on a linked file out of the resolved path", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[cache-busted](./file.zip?v=2)", ctx);
    expect(html).toContain('href="file.zip?v=2"');
    expect(ctx.assets.get("/ws/file.zip")).toBe("file.zip");
  });

  it("leaves links to folders alone", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render("[trailing](./downloads/) [up](..) [here](.)", ctx);
    expect(html).toContain('href="./downloads/"');
    expect(html).toContain('href=".."');
    expect(html).toContain('href="."');
    expect(ctx.assets.size).toBe(0);
  });

  it("sends a linked file that would overwrite a generated file to assets/", async () => {
    // Assets are copied after the pages are written, so mirroring a workspace
    // index.html, page, or style.css onto its own path would overwrite it.
    const ctx = makeCtx("/ws/README.md", "index.html");
    const html = await render(
      "[old home](./index.html) [old page](./other.html) [css](./style.css)",
      ctx,
    );
    expect(html).toContain('href="assets/index.html"');
    expect(html).toContain('href="assets/other.html"');
    expect(html).toContain('href="assets/style.css"');
  });

  it("percent-encodes spaces in a rewritten link", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render("[the report](<./my docs/q1 report.pdf>)", ctx);
    expect(html).toContain('href="my%20docs/q1%20report.pdf"');
    expect(ctx.assets.get("/ws/my docs/q1 report.pdf")).toBe("my docs/q1 report.pdf");
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

  it("rewrites svg <image> hrefs and records the asset copy", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render('<svg><image href="./img/icon.png"/></svg>', ctx);
    expect(html).toContain('href="img/icon.png"');
    expect(ctx.assets.get("/ws/guide/img/icon.png")).toBe("guide/img/icon.png");
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

  it("redirects media and its poster into the site tree and forces playback attributes", async () => {
    const ctx = makeCtx("/ws/guide/intro.md", "guide/intro.html");
    const html = await render(
      '<video src="clips/demo.mp4" poster="clips/cover.png"></video>' +
        '<audio src="clips/memo.mp3"></audio>',
      ctx,
    );

    expect(html).toContain('src="clips/demo.mp4"');
    expect(html).toContain('poster="clips/cover.png"');
    expect(ctx.assets.get("/ws/guide/clips/demo.mp4")).toBe("guide/clips/demo.mp4");
    expect(ctx.assets.get("/ws/guide/clips/cover.png")).toBe("guide/clips/cover.png");
    expect(ctx.assets.get("/ws/guide/clips/memo.mp3")).toBe("guide/clips/memo.mp3");
    // The viewer forces these from its components; a static page has nowhere
    // else to get them, and without controls the player can never be started.
    expect(html).toContain("controls");
    expect(html).toContain('preload="none"');
  });

  it("redirects a <source> child of a media element", async () => {
    const ctx = makeCtx("/ws/other.md", "other.html");
    const html = await render(
      '<video><source src="clips/demo.webm" type="video/webm"></video>',
      ctx,
    );

    expect(html).toContain('src="clips/demo.webm"');
    expect(ctx.assets.get("/ws/clips/demo.webm")).toBe("clips/demo.webm");
  });
});
