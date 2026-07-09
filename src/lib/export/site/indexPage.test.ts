import { describe, expect, it } from "vitest";
import { buildIndexBodyHtml } from "./indexPage";

describe("buildIndexBodyHtml", () => {
  it("titles the page with the workspace name and lists every page", () => {
    const body = buildIndexBodyHtml("My Notes", [
      { rel: "b.html", title: "Bee" },
      { rel: "a/x.html", title: "Ex" },
    ]);
    expect(body).toContain("<h1>My Notes</h1>");
    expect(body).toContain('<a href="a/x.html">Ex</a>');
    expect(body).toContain('<a href="b.html">Bee</a>');
    expect(body.indexOf("a/x.html")).toBeLessThan(body.indexOf("b.html"));
  });

  it("escapes names and encodes hrefs", () => {
    const body = buildIndexBodyHtml("A & B", [{ rel: "my page.html", title: "<T>" }]);
    expect(body).toContain("<h1>A &amp; B</h1>");
    expect(body).toContain('href="my%20page.html"');
    expect(body).toContain("&lt;T&gt;");
  });
});
