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
});
