import { describe, expect, it } from "vitest";
import { buildPageMetaHtml, pageDescription, pageDocumentTitle } from "./pageMeta";

const BASE = {
  siteTitle: "My Site",
  pageTitle: "Intro",
  isIndex: false,
  description: null,
  pageRel: "guide/intro.html",
  baseUrl: null,
  faviconRel: null,
  socialImageRel: null,
};

describe("pageDocumentTitle", () => {
  it("suffixes the site name onto page titles", () => {
    expect(pageDocumentTitle("Intro", "My Site", false)).toBe("Intro · My Site");
  });

  it("uses the plain site name on the index and for same-named pages", () => {
    expect(pageDocumentTitle("Anything", "My Site", true)).toBe("My Site");
    expect(pageDocumentTitle("My Site", "My Site", false)).toBe("My Site");
  });
});

describe("pageDescription", () => {
  it("prefers the page frontmatter description", () => {
    const content = "---\ntitle: T\ndescription: Page blurb\n---\n\nBody";
    expect(pageDescription(content, "site blurb")).toBe("Page blurb");
  });

  it("falls back to the site description, then to null", () => {
    expect(pageDescription("# Plain", "site blurb")).toBe("site blurb");
    expect(pageDescription("# Plain", "")).toBeNull();
  });
});

describe("buildPageMetaHtml", () => {
  it("emits og and twitter tags for an article page", () => {
    const html = buildPageMetaHtml({ ...BASE, description: "Blurb" });
    expect(html).toContain('<meta property="og:title" content="Intro">');
    expect(html).toContain('<meta property="og:site_name" content="My Site">');
    expect(html).toContain('<meta property="og:type" content="article">');
    expect(html).toContain('<meta name="description" content="Blurb">');
    expect(html).toContain('<meta property="og:description" content="Blurb">');
    expect(html).toContain('<meta name="twitter:card" content="summary">');
    expect(html).not.toContain("og:url");
  });

  it("treats the index as the website itself", () => {
    const html = buildPageMetaHtml({ ...BASE, isIndex: true, pageRel: "index.html" });
    expect(html).toContain('<meta property="og:title" content="My Site">');
    expect(html).toContain('<meta property="og:type" content="website">');
  });

  it("emits absolute og:url and og:image only under a base URL", () => {
    const html = buildPageMetaHtml({
      ...BASE,
      baseUrl: "https://example.com/notes/",
      socialImageRel: "assets/card image.png",
    });
    expect(html).toContain(
      '<meta property="og:url" content="https://example.com/notes/guide/intro.html">',
    );
    expect(html).toContain(
      '<meta property="og:image" content="https://example.com/notes/assets/card%20image.png">',
    );
    expect(html).toContain('<meta name="twitter:card" content="summary_large_image">');
  });

  it("uses the bare base URL for the index page og:url", () => {
    const html = buildPageMetaHtml({
      ...BASE,
      isIndex: true,
      pageRel: "index.html",
      baseUrl: "https://example.com/",
    });
    expect(html).toContain('<meta property="og:url" content="https://example.com/">');
  });

  it("links the favicon relative to the page with the right type", () => {
    const html = buildPageMetaHtml({ ...BASE, faviconRel: "favicon.svg" });
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="../favicon.svg">');
    const ico = buildPageMetaHtml({ ...BASE, pageRel: "index.html", faviconRel: "favicon.ico" });
    expect(ico).toContain('<link rel="icon" type="image/x-icon" href="favicon.ico">');
  });

  it("maps webp and omits the type attribute for unknown extensions", () => {
    const webp = buildPageMetaHtml({ ...BASE, pageRel: "a.html", faviconRel: "icon.webp" });
    expect(webp).toContain('<link rel="icon" type="image/webp" href="icon.webp">');
    const unknown = buildPageMetaHtml({ ...BASE, pageRel: "a.html", faviconRel: "icon.bmp" });
    expect(unknown).toContain('<link rel="icon" href="icon.bmp">');
  });

  it("escapes titles and descriptions", () => {
    const html = buildPageMetaHtml({
      ...BASE,
      pageTitle: 'A "quoted" <title>',
      description: "x & y",
    });
    expect(html).toContain('content="A &quot;quoted&quot; &lt;title&gt;"');
    expect(html).toContain('content="x &amp; y"');
  });
});
