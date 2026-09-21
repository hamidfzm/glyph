import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vitest";
import { rehypePreviewImages } from "./previewImages";

const BASE = "https://glyph-document.example/";

async function render(markdown: string): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypePreviewImages, BASE)
    .use(rehypeStringify)
    .process(markdown);
  return String(file);
}

describe("rehypePreviewImages", () => {
  it("points images in the file's folder at the document host", async () => {
    expect(await render("![shot](screenshot.png)")).toContain(`src="${BASE}screenshot.png"`);
  });

  it("keeps subfolders and encodes spaces", async () => {
    const html = await render("![a](<./assets/my shot.png>)");
    expect(html).toContain(`src="${BASE}assets/my%20shot.png"`);
  });

  it("replaces a remote image with its alt text", async () => {
    const html = await render("![a remote chart](https://example.com/chart.png)");
    expect(html).not.toContain("example.com");
    expect(html).toContain("a remote chart");
  });

  it("replaces an image outside the folder with its alt text", async () => {
    // URL resolution clamps `..` at the host root, which would silently load a
    // same-named file from the folder instead.
    const html = await render("![escaping](../secrets/key.png)");
    expect(html).not.toContain("img");
    expect(html).toContain("escaping");
  });

  it("replaces absolute and data sources with their alt text", async () => {
    for (const src of ["/etc/logo.png", "C:\\pics\\logo.png", "data:image/png;base64,AAAA"]) {
      const html = await render(`![logo](${src})`);
      expect(html).not.toContain("<img");
      expect(html).toContain("logo");
    }
  });

  it("drops an image with no alt text entirely", async () => {
    expect(await render("![](https://example.com/chart.png)")).toBe("<p></p>");
  });
});
