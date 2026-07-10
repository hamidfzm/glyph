import { describe, expect, it } from "vitest";
import { buildHtmlDocument } from "./html";

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
    // The nav is chrome, not content: hidden when printing.
    expect(out).toContain("@media print { .glyph-site-nav { display: none; } }");
  });
});
