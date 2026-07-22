import { describe, expect, it } from "vitest";
import { buildHtmlDocument, siteChromeCss, siteChromeScript } from "./html";

describe("buildHtmlDocument", () => {
  it("wraps body and css in a standalone document with the markdown-body class", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>hello</p>",
      title: "My Doc",
      css: ".markdown-body{color:red}",
      dark: false,
    });
    expect(out).toContain("<!doctype html>");
    expect(out).toContain("<title>My Doc</title>");
    expect(out).toContain("<style>\n.markdown-body{color:red}");
    expect(out).toContain('<div class="markdown-body" dir="auto">');
    expect(out).toContain("<p>hello</p>");
    expect(out).not.toContain('<html lang="en" class="dark">');
  });

  it("adds the dark class to <html> when dark is true", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: true });
    expect(out).toContain('<html lang="en" class="dark">');
  });

  it("escapes the title", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "A & <B>", css: "", dark: false });
    expect(out).toContain("<title>A &amp; &lt;B&gt;</title>");
  });

  it("resets the shell's locked viewport so the page scrolls", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: false });
    expect(out).toContain("html, body { height: auto; min-height: 100%; overflow: visible; }");
    expect(out).toContain(".markdown-body, .notebook-body { max-width: 820px");
  });

  it("wraps wide code blocks only when printing (keeps on-screen scroll)", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: false });
    // The wrap rule lives inside the @media print block, after its opening brace.
    const printIdx = out.indexOf("@media print");
    expect(printIdx).toBeGreaterThan(-1);
    expect(out.indexOf("white-space: pre-wrap")).toBeGreaterThan(printIdx);
    expect(out).toContain("overflow-wrap: anywhere");
  });

  it("uses the given body class so notebook styles apply", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>cell</p>",
      title: "nb",
      css: "",
      dark: false,
      bodyClass: "notebook-body",
    });
    expect(out).toContain('<div class="notebook-body" dir="auto">');
  });

  it("syncs to the reader's system theme via prefers-color-scheme", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: false });
    expect(out).toContain('<meta name="color-scheme" content="light dark">');
    expect(out).toContain("prefers-color-scheme: dark");
    expect(out).toContain("classList.toggle('dark'");
  });

  it("includes a dark/light toggle that persists the choice", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: false });
    expect(out).toContain('id="glyph-theme-toggle"');
    // The toggle stores the user's choice so it survives reloads.
    expect(out).toContain("localStorage");
    // ...and is hidden when printing.
    expect(out).toContain("#glyph-theme-toggle { display: none; }");
  });

  it("switches native-control color-scheme with the dark class", () => {
    const html = buildHtmlDocument({ bodyHtml: "<p>x</p>", title: "t", css: "", dark: false });
    expect(html).toContain(":root { color-scheme: light; }");
    expect(html).toContain(":root.dark { color-scheme: dark; }");
  });

  it("links a shared stylesheet for site pages, escaping the href", () => {
    const out = buildHtmlDocument({
      bodyHtml: "",
      title: "t",
      css: "",
      dark: false,
      stylesheetHref: "../style.css?a&b",
    });
    expect(out).toContain('<link rel="stylesheet" href="../style.css?a&amp;b">');
    // The shared sheet owns all CSS; the page carries no <style> of its own.
    expect(out).not.toContain("<style>");
  });

  it("links a shared theme script for site pages instead of inlining it", () => {
    const out = buildHtmlDocument({
      bodyHtml: "",
      title: "t",
      css: "",
      dark: false,
      scriptHref: "../site.js",
    });
    expect(out).toContain('<script src="../site.js"></script>');
    expect(out).not.toContain("glyph-export-theme");
  });

  it("exposes the shared site chrome for the exporter to write once", () => {
    // Everything a site page needs from the dropped inline blocks must be in
    // the shared chrome: viewport reset, toggle styles, layout, theme script.
    const css = siteChromeCss();
    expect(css).toContain("html, body { height: auto;");
    expect(css).toContain("#glyph-theme-toggle");
    expect(css).toContain(".glyph-site {");
    expect(css).toContain(".glyph-site-outline {");
    expect(siteChromeScript()).toContain("glyph-export-theme");
  });

  it("animates the nav disclosures and anchor jumps, gated on reduced motion", () => {
    const css = siteChromeCss();
    expect(css).toContain("scroll-behavior: smooth");
    expect(css).toContain("scroll-margin-top");
    expect(css).toContain("details[open] > summary::before");
    expect(css).toContain("prefers-reduced-motion");
  });

  it("ships the outline scroll spy in the shared site script, not in single files", () => {
    expect(siteChromeScript()).toContain("glyph-site-outline");
    expect(siteChromeScript()).toContain("classList.add('active')");
    const single = buildHtmlDocument({ bodyHtml: "<p>x</p>", title: "t", css: "", dark: false });
    expect(single).not.toContain("glyph-site-outline");
  });

  it("omits the stylesheet link and site layout for single-file exports", () => {
    const out = buildHtmlDocument({ bodyHtml: "", title: "t", css: "", dark: false });
    expect(out).not.toContain("<link rel=");
    expect(out).not.toContain("glyph-site");
  });

  it("wraps content in the two-pane site layout when nav markup is given", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>x</p>",
      title: "t",
      css: "",
      dark: false,
      navHtml: '<nav class="glyph-site-nav"><ul></ul></nav>',
    });
    expect(out).toContain('<div class="glyph-site">');
    expect(out).toContain('<nav class="glyph-site-nav">');
    expect(out).toContain('<main class="glyph-site-main">');
    // Nav and outline are chrome, not content: hidden when printing.
    expect(out).toContain(
      "@media print { .glyph-site-header, .glyph-site-nav, .glyph-site-outline { display: none; } }",
    );
  });

  it("adds the outline column after the content when outline markup is given", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>x</p>",
      title: "t",
      css: "",
      dark: false,
      navHtml: '<nav class="glyph-site-nav"><ul></ul></nav>',
      outlineHtml: '<nav class="glyph-site-outline"><ul></ul></nav>',
    });
    expect(out).toContain('<nav class="glyph-site-outline">');
    expect(out.indexOf("glyph-site-main")).toBeLessThan(
      out.indexOf('<nav class="glyph-site-outline">'),
    );
    // Hidden on narrow viewports rather than stacked below the content.
    expect(out).toContain("@media (max-width: 1024px) { .glyph-site-outline { display: none; } }");
  });

  it("omits the outline element when a page has none", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>x</p>",
      title: "t",
      css: "",
      dark: false,
      navHtml: '<nav class="glyph-site-nav"><ul></ul></nav>',
      outlineHtml: null,
    });
    expect(out).not.toContain('<nav class="glyph-site-outline">');
  });

  it("renders the site header before the columns when given", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>x</p>",
      title: "t",
      css: "",
      dark: false,
      navHtml: '<nav class="glyph-site-nav"><ul></ul></nav>',
      headerHtml: '<header class="glyph-site-header"><a href="index.html">Site</a></header>',
    });
    expect(out.indexOf("glyph-site-header")).toBeLessThan(out.indexOf('<div class="glyph-site">'));
    // Chrome, not content: hidden when printing along with nav and outline.
    expect(out).toContain(
      "@media print { .glyph-site-header, .glyph-site-nav, .glyph-site-outline { display: none; } }",
    );
  });

  it("emits extra head markup verbatim after the title", () => {
    const out = buildHtmlDocument({
      bodyHtml: "",
      title: "t",
      css: "",
      dark: false,
      headHtml: '<link rel="icon" href="favicon.ico">\n<meta property="og:title" content="t">',
    });
    const title = out.indexOf("</title>");
    const icon = out.indexOf('<link rel="icon"');
    expect(icon).toBeGreaterThan(title);
    expect(out).toContain('<meta property="og:title" content="t">');
  });
});
