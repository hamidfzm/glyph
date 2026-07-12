import { describe, expect, it } from "vitest";
import { buildOutlineHtml } from "./outline";

describe("buildOutlineHtml", () => {
  it("lists headings with level classes and fragment links", () => {
    const outline = buildOutlineHtml(
      '<h1 id="intro">Intro</h1><p>x</p><h2 id="setup">Setup</h2><h3 id="deep">Deep</h3>',
    );
    expect(outline).toContain('<nav class="glyph-site-outline"');
    expect(outline).toContain('<li class="glyph-outline-l1"><a href="#intro">Intro</a></li>');
    expect(outline).toContain('<li class="glyph-outline-l2"><a href="#setup">Setup</a></li>');
    expect(outline).toContain('<li class="glyph-outline-l3"><a href="#deep">Deep</a></li>');
  });

  it("returns null for pages with fewer than two headings", () => {
    expect(buildOutlineHtml('<h1 id="only">Only</h1><p>body</p>')).toBeNull();
    expect(buildOutlineHtml("<p>no headings</p>")).toBeNull();
  });

  it("skips headings without an id (nothing to link to)", () => {
    const outline = buildOutlineHtml('<h1 id="a">A</h1><h2>anon</h2><h2 id="b">B</h2>');
    expect(outline).not.toContain("anon");
    expect(outline).toContain(">B</a>");
  });

  it("escapes heading text and keeps only the text of rich headings", () => {
    const outline = buildOutlineHtml(
      '<h1 id="a">A &amp; B</h1><h2 id="b"><code>x&lt;y</code> tag</h2>',
    );
    expect(outline).toContain(">A &amp; B</a>");
    expect(outline).toContain(">x&lt;y tag</a>");
    expect(outline).not.toContain("<code>");
  });
});
