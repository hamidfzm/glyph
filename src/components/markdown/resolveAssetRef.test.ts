import { describe, expect, it } from "vitest";
import { resolveAssetRef } from "./resolveAssetRef";

// convertFileSrc is mocked globally in src/test/setup.ts to
// `asset://localhost/<path>`.

describe("resolveAssetRef", () => {
  it("resolves nothing when src is missing", () => {
    expect(resolveAssetRef(undefined, "/ws/doc.md")).toEqual({ src: undefined, path: undefined });
  });

  it("passes remote URLs through untouched, with no local path", () => {
    expect(resolveAssetRef("https://example.com/x.png", "/ws/doc.md")).toEqual({
      src: "https://example.com/x.png",
      path: undefined,
    });
  });

  it("passes data URIs through untouched", () => {
    expect(resolveAssetRef("data:image/png;base64,AAAA", "/ws/doc.md").src).toMatch(
      /^data:image\/png/,
    );
  });

  it("leaves the src alone when no file path is known", () => {
    expect(resolveAssetRef("cover.png", undefined).src).toBe("cover.png");
  });

  it("resolves a relative path against the document directory", () => {
    expect(resolveAssetRef("img/cover.png", "/ws/notes/doc.md")).toEqual({
      src: "asset://localhost//ws/notes/img/cover.png",
      path: "/ws/notes/img/cover.png",
    });
  });

  it("resolves a ../ path up the tree", () => {
    expect(resolveAssetRef("../assets/cover.png", "/ws/notes/doc.md").src).toBe(
      "asset://localhost//ws/assets/cover.png",
    );
  });

  it("strips a Windows verbatim prefix from the resolved path", () => {
    const out = decodeURIComponent(
      resolveAssetRef("./diagram.svg", "\\\\?\\C:\\ws\\notes\\doc.md").src ?? "",
    );
    expect(out).not.toContain("\\\\?\\");
    expect(out).toContain("C:\\ws\\notes\\diagram.svg");
  });

  it("resolves an in-root image when a workspace root is set", () => {
    expect(resolveAssetRef("../assets/cover.png", "/ws/notes/doc.md", "/ws").src).toBe(
      "asset://localhost//ws/assets/cover.png",
    );
  });

  it("refuses an image that escapes the workspace root", () => {
    expect(resolveAssetRef("../../secret/cover.png", "/ws/notes/doc.md", "/ws")).toEqual({
      src: undefined,
      path: undefined,
    });
  });
});
