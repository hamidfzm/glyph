import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it, vi } from "vitest";
import { type ImageSource, rehypePreviewImages } from "./previewImages";

const BASE = "https://glyph-document.example/";

async function render(markdown: string, images: ImageSource = BASE, onDrop = () => {}) {
  const file = await unified()
    .use(remarkParse)
    // Raw HTML reaches the plugin in the real pipeline, so it does here too.
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeRaw)
    .use(rehypePreviewImages, images, onDrop)
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

  it("replaces even a relative image with its alt text when no folder is served", async () => {
    for (const images of [null, ""]) {
      const html = await render("![shot](screenshot.png)", images);
      expect(html).not.toContain("<img");
      expect(html).toContain("shot");
    }
  });

  it("loads a relative image from the folder the reader picked", async () => {
    const picked = vi.fn((src: string) => (src === "./assets/shot.png" ? "blob:shot" : null));
    const html = await render("![shot](./assets/shot.png) ![gone](gone.png)", picked);
    expect(html).toContain('src="blob:shot"');
    expect(html).toContain("gone");
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it("never asks the picked folder for a remote, absolute or escaping image", async () => {
    const picked = vi.fn(() => "blob:anything");
    for (const src of [
      "https://example.com/chart.png",
      "/pics/logo.png",
      "C:\\pics\\logo.png",
      "../pics/logo.png",
      "pics/../../logo.png",
    ]) {
      const html = await render(`![logo](${src})`, picked);
      expect(html).not.toContain("<img");
    }
    expect(picked).not.toHaveBeenCalled();
  });

  it("reports each relative image it drops, and no other", async () => {
    const onDrop = vi.fn();
    const markdown = "![a](a.png) <img src='b.png' alt='b'> ![far](https://example.com/c.png)";
    await render(markdown, null, onDrop);
    expect(onDrop).toHaveBeenCalledTimes(2);
    onDrop.mockClear();
    await render(markdown, BASE, onDrop);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("drops a raw img that carries neither source nor alt text", async () => {
    expect(await render("<img>")).toBe("");
    expect(await render('<img src="https://example.com/chart.png">')).toBe("");
  });
});
