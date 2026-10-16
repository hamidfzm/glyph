import { describe, expect, it } from "vitest";
import { quotedImageUrls } from "./quotedImageUrls";

describe("quotedImageUrls", () => {
  it("collects the http(s) URLs a document names, once each", () => {
    const doc = [
      "![chart](https://img.test/chart.png)",
      "See https://img.test/chart.png and <https://img.test/b.png>.",
      '[link](HTTP://img.test/c.png "title") ftp://img.test/d.png /local/e.png',
    ].join("\n");
    expect(quotedImageUrls(doc)).toEqual([
      "https://img.test/chart.png",
      "https://img.test/b.png",
      "HTTP://img.test/c.png",
    ]);
  });

  it("drops the punctuation that ends a sentence around a bare URL", () => {
    expect(quotedImageUrls("Look at https://img.test/a.png, or https://img.test/b.png!")).toEqual([
      "https://img.test/a.png",
      "https://img.test/b.png",
    ]);
  });

  it("encodes a URL the way the markdown renderer will", () => {
    expect(quotedImageUrls("![](https://img.test/نمودار.png) https://img.test/a%20b.png")).toEqual([
      "https://img.test/%D9%86%D9%85%D9%88%D8%AF%D8%A7%D8%B1.png",
      "https://img.test/a%20b.png",
    ]);
  });

  it("finds nothing in a document without URLs", () => {
    expect(quotedImageUrls("# Notes\n\nNo links here.")).toEqual([]);
  });
});
