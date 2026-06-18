import { describe, expect, it } from "vitest";
import { isRelativeLocalHref, normalizeRelativePath } from "./relativePath";

describe("normalizeRelativePath", () => {
  it("joins a bare relative path onto the document's directory", () => {
    expect(normalizeRelativePath("/ws/notes/doc.md", "other.md")).toBe("/ws/notes/other.md");
  });

  it("collapses a leading ./ segment", () => {
    expect(normalizeRelativePath("/ws/notes/doc.md", "./other.md")).toBe("/ws/notes/other.md");
  });

  it("walks up a single ../ segment", () => {
    expect(normalizeRelativePath("/ws/notes/doc.md", "../other.md")).toBe("/ws/other.md");
  });

  it("walks up nested ../../ segments", () => {
    expect(normalizeRelativePath("/ws/a/b/doc.md", "../../c.md")).toBe("/ws/c.md");
  });

  it("resolves a mix of descend and ascend segments", () => {
    expect(normalizeRelativePath("/ws/a/doc.md", "../b/c/note.md")).toBe("/ws/b/c/note.md");
  });

  it("drops a trailing #heading before resolving", () => {
    expect(normalizeRelativePath("/ws/doc.md", "./other.md#section")).toBe("/ws/other.md");
  });

  it("keeps Windows backslash separators and the drive root", () => {
    expect(normalizeRelativePath("C:\\ws\\notes\\doc.md", "../img/cover.png")).toBe(
      "C:\\ws\\img\\cover.png",
    );
  });

  it("preserves a Windows verbatim prefix while resolving", () => {
    expect(normalizeRelativePath("\\\\?\\C:\\ws\\notes\\doc.md", "./diagram.svg")).toBe(
      "\\\\?\\C:\\ws\\notes\\diagram.svg",
    );
  });

  it("clamps excess ../ at the filesystem root rather than throwing", () => {
    // The escape itself is rejected later by isPathInside; here we only assert
    // resolution stays well-formed.
    expect(normalizeRelativePath("/ws/doc.md", "../../../etc/passwd")).toBe("/etc/passwd");
  });

  it("treats a percent-encoded ../ literally rather than decoding it to traversal", () => {
    // %2E%2E is the encoded form of "..". We do not URL-decode, so it stays a
    // literal path segment and cannot be used to climb out of the workspace.
    expect(normalizeRelativePath("/ws/notes/doc.md", "%2E%2E/secret.md")).toBe(
      "/ws/notes/%2E%2E/secret.md",
    );
  });
});

describe("isRelativeLocalHref", () => {
  it.each([
    "other.md",
    "./a.md",
    "../b/c.md",
    "sub/d.canvas",
  ])("treats %s as a relative local href", (href) => {
    expect(isRelativeLocalHref(href)).toBe(true);
  });

  it.each([
    "#heading",
    "//cdn.example.com/x",
    "http://example.com",
    "https://example.com/a.md",
    "mailto:me@example.com",
    "data:text/plain,hi",
    "/abs/x.md",
    "\\\\server\\share\\x.md",
    "C:\\ws\\x.md",
    "",
  ])("treats %s as not a relative local href", (href) => {
    expect(isRelativeLocalHref(href)).toBe(false);
  });
});
