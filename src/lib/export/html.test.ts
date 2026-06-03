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
    expect(out).toContain('<div class="markdown-body">');
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

  it("uses the given body class so notebook styles apply", () => {
    const out = buildHtmlDocument({
      bodyHtml: "<p>cell</p>",
      title: "nb",
      css: "",
      dark: false,
      bodyClass: "notebook-body",
    });
    expect(out).toContain('<div class="notebook-body">');
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
    expect(out).toContain("@media print { #glyph-theme-toggle");
  });
});
