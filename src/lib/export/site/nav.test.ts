import { describe, expect, it } from "vitest";
import { buildNavHtml, type SitePage } from "./nav";

const PAGES: SitePage[] = [
  { rel: "index.html", title: "Home" },
  { rel: "zeta.html", title: "Zeta" },
  { rel: "guide/intro.html", title: "Intro" },
  { rel: "guide/advanced.html", title: "Advanced" },
];

describe("buildNavHtml", () => {
  it("nests folder pages inside a details disclosure", () => {
    const nav = buildNavHtml(PAGES, "index.html");
    expect(nav).toContain("<nav");
    expect(nav).toContain("<details open><summary>guide</summary>");
    expect(nav).toContain(">Intro</a>");
    expect(nav).toContain(">Advanced</a>");
  });

  it("relativizes hrefs to the current page", () => {
    const nav = buildNavHtml(PAGES, "guide/intro.html");
    expect(nav).toContain('href="../index.html"');
    expect(nav).toContain('href="advanced.html"');
  });

  it("marks the current page with aria-current", () => {
    const nav = buildNavHtml(PAGES, "zeta.html");
    expect(nav).toContain('href="zeta.html" aria-current="page"');
  });

  it("puts index.html first at the root, then pages alphabetically by title", () => {
    const nav = buildNavHtml(PAGES, "index.html");
    const home = nav.indexOf(">Home</a>");
    const zeta = nav.indexOf(">Zeta</a>");
    expect(home).toBeGreaterThan(-1);
    expect(home).toBeLessThan(zeta);
  });

  it("escapes titles and folder names", () => {
    const nav = buildNavHtml([{ rel: "a&b/x.html", title: "T <i>" }], "x.html");
    expect(nav).toContain("a&amp;b");
    expect(nav).toContain("T &lt;i&gt;");
  });
});
