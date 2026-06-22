import { describe, expect, it } from "vitest";
import { resolveImageSrc } from "./resolveImageSrc";

// convertFileSrc is mocked globally in src/test/setup.ts to
// `asset://localhost/<path>`.

describe("resolveImageSrc", () => {
  it("returns undefined when src is missing", () => {
    expect(resolveImageSrc(undefined, "/ws/doc.md")).toBeUndefined();
  });

  it("passes remote URLs through untouched", () => {
    expect(resolveImageSrc("https://example.com/x.png", "/ws/doc.md")).toBe(
      "https://example.com/x.png",
    );
  });

  it("passes data URIs through untouched", () => {
    expect(resolveImageSrc("data:image/png;base64,AAAA", "/ws/doc.md")).toMatch(/^data:image\/png/);
  });

  it("leaves the src alone when no file path is known", () => {
    expect(resolveImageSrc("cover.png", undefined)).toBe("cover.png");
  });

  it("resolves a relative path against the document directory", () => {
    const out = resolveImageSrc("img/cover.png", "/ws/notes/doc.md") ?? "";
    expect(out).toBe("asset://localhost//ws/notes/img/cover.png");
  });

  it("resolves a ../ path up the tree", () => {
    const out = resolveImageSrc("../assets/cover.png", "/ws/notes/doc.md") ?? "";
    expect(out).toBe("asset://localhost//ws/assets/cover.png");
  });

  it("strips a Windows verbatim prefix from the resolved path", () => {
    const out = decodeURIComponent(
      resolveImageSrc("./diagram.svg", "\\\\?\\C:\\ws\\notes\\doc.md") ?? "",
    );
    expect(out).not.toContain("\\\\?\\");
    expect(out).toContain("C:\\ws\\notes\\diagram.svg");
  });

  it("resolves an in-root image when a workspace root is set", () => {
    const out = resolveImageSrc("../assets/cover.png", "/ws/notes/doc.md", "/ws") ?? "";
    expect(out).toBe("asset://localhost//ws/assets/cover.png");
  });

  it("refuses an image that escapes the workspace root", () => {
    expect(resolveImageSrc("../../secret/cover.png", "/ws/notes/doc.md", "/ws")).toBeUndefined();
  });
});
