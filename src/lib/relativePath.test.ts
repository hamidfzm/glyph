import { describe, expect, it } from "vitest";
import {
  clampRootFor,
  isOpenableRelativeHref,
  isRelativeLocalHref,
  normalizeRelativePath,
  resolveWorkspacePath,
} from "./relativePath";

describe("normalizeRelativePath at the volume root", () => {
  // Climbing past `\\?\C:` or a share would name another host, which Windows
  // contacts with the user's credentials.
  it("stops ../ at a verbatim drive prefix", () => {
    expect(
      normalizeRelativePath("\\\\?\\C:\\notes\\doc.md", "../../../evil.example/share/x.png"),
    ).toBe("\\\\?\\C:\\evil.example\\share\\x.png");
  });

  it("stops ../ at a plain drive rather than going relative", () => {
    expect(normalizeRelativePath("C:\\notes\\doc.md", "../../x.png")).toBe("C:\\x.png");
  });

  it("stops ../ at a UNC share", () => {
    expect(normalizeRelativePath("\\\\server\\share\\doc.md", "../../other/x.png")).toBe(
      "\\\\server\\share\\other\\x.png",
    );
  });

  it("stops ../ at a verbatim UNC share", () => {
    expect(normalizeRelativePath("\\\\?\\UNC\\server\\share\\doc.md", "../../../../x.png")).toBe(
      "\\\\?\\UNC\\server\\share\\x.png",
    );
  });
});

describe("clampRootFor", () => {
  it("clamps a document inside the workspace to its root", () => {
    expect(clampRootFor("/ws/notes/doc.md", "/ws")).toBe("/ws");
  });

  it("leaves a document opened from outside the workspace unclamped", () => {
    expect(clampRootFor("/elsewhere/doc.md", "/ws")).toBeUndefined();
  });

  it("has nothing to clamp without a document or a workspace", () => {
    expect(clampRootFor(undefined, "/ws")).toBeUndefined();
    expect(clampRootFor("/ws/doc.md", undefined)).toBeUndefined();
  });
});

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
  it.each(["other.md", "./a.md", "../b/c.md", "sub/d.canvas"])(
    "treats %s as a relative local href",
    (href) => {
      expect(isRelativeLocalHref(href)).toBe(true);
    },
  );

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

describe("resolveWorkspacePath", () => {
  it("resolves a relative target against the document directory", () => {
    expect(resolveWorkspacePath("/ws/notes/doc.md", "../other.md", "/ws")).toBe("/ws/other.md");
  });

  it("returns null when the target escapes the root", () => {
    expect(resolveWorkspacePath("/ws/notes/doc.md", "../../etc/passwd", "/ws")).toBeNull();
  });

  it("does not clamp when no root is given (single-file mode)", () => {
    expect(resolveWorkspacePath("/ws/notes/doc.md", "../../etc/passwd", undefined)).toBe(
      "/etc/passwd",
    );
  });

  it("drops a trailing #heading", () => {
    expect(resolveWorkspacePath("/ws/doc.md", "./other.md#section", "/ws")).toBe("/ws/other.md");
  });
});

describe("isOpenableRelativeHref", () => {
  it.each(["./sibling.md", "../notes.markdown", "../diagrams/board.canvas", "sub/note.md#heading"])(
    "opens %s in the workspace",
    (href) => {
      expect(isOpenableRelativeHref(href)).toBe(true);
    },
  );

  it.each([
    "./image.png", // relative, but not a markdown/canvas target
    "./data.txt",
    "https://example.com/page.md", // external URL ending in .md
    "#heading",
    "/abs/note.md",
    undefined,
  ])("does not open %s in the workspace", (href) => {
    expect(isOpenableRelativeHref(href)).toBe(false);
  });
});
