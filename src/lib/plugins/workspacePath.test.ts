import { describe, expect, it } from "vitest";
import { resolveInsideRoot, resolveWorkspacePath, workspaceRelativePath } from "./workspacePath";

describe("resolveWorkspacePath", () => {
  it("accepts a file by absolute path or relative to the root, as one spelling", () => {
    expect(resolveWorkspacePath("/ws", "/ws/notes/a.md")).toBe("/ws/notes/a.md");
    expect(resolveWorkspacePath("/ws", "notes/a.md")).toBe("/ws/notes/a.md");
    expect(resolveWorkspacePath("C:\\ws", "C:\\ws/notes/a.md")).toBe("C:\\ws\\notes\\a.md");
  });

  it("works for a workspace at a drive or filesystem root", () => {
    expect(resolveWorkspacePath("D:\\", "D:\\notes\\a.md")).toBe("D:\\notes\\a.md");
    expect(resolveWorkspacePath("/", "/notes/a.md")).toBe("/notes/a.md");
  });

  it("refuses the root itself and anything outside it", () => {
    expect(resolveWorkspacePath("/ws", "/ws")).toBeNull();
    expect(resolveWorkspacePath("/ws", "/ws/")).toBeNull();
    expect(resolveWorkspacePath("/ws", "/ws-other/a.md")).toBeNull();
    expect(resolveWorkspacePath("/ws", "/ws/../etc/passwd")).toBeNull();
    expect(resolveWorkspacePath("C:\\ws", "D:\\ws\\a.md")).toBeNull();
  });
});

describe("resolveInsideRoot", () => {
  it("resolves simple and nested relative paths", () => {
    expect(resolveInsideRoot("/ws", "notes.md")).toBe("/ws/notes.md");
    expect(resolveInsideRoot("/ws", "sub/deep/notes.md")).toBe("/ws/sub/deep/notes.md");
    expect(resolveInsideRoot("/ws/", "notes.md")).toBe("/ws/notes.md");
  });

  it("uses backslashes when the root does", () => {
    expect(resolveInsideRoot("C:\\ws", "sub/notes.md")).toBe("C:\\ws\\sub\\notes.md");
    expect(resolveInsideRoot("C:\\ws\\", "sub\\notes.md")).toBe("C:\\ws\\sub\\notes.md");
  });

  it("collapses . and safe .. segments", () => {
    expect(resolveInsideRoot("/ws", "./a/./b.md")).toBe("/ws/a/b.md");
    expect(resolveInsideRoot("/ws", "a/../b.md")).toBe("/ws/b.md");
  });

  it("rejects escapes above the root", () => {
    expect(resolveInsideRoot("/ws", "../secret")).toBeNull();
    expect(resolveInsideRoot("/ws", "a/../../secret")).toBeNull();
    expect(resolveInsideRoot("/ws", "..\\secret")).toBeNull();
  });

  it("rejects absolute inputs", () => {
    expect(resolveInsideRoot("/ws", "/etc/passwd")).toBeNull();
    expect(resolveInsideRoot("C:\\ws", "C:\\Windows\\system.ini")).toBeNull();
    expect(resolveInsideRoot("C:\\ws", "\\\\server\\share")).toBeNull();
  });

  it("rejects paths that resolve to the root itself", () => {
    expect(resolveInsideRoot("/ws", "")).toBeNull();
    expect(resolveInsideRoot("/ws", ".")).toBeNull();
    expect(resolveInsideRoot("/ws", "a/..")).toBeNull();
  });
});

describe("workspaceRelativePath", () => {
  it("writes a relative path with forward slashes, whichever separator came in", () => {
    expect(workspaceRelativePath("daily\\2026\\note.md")).toBe("daily/2026/note.md");
    expect(workspaceRelativePath("./a//b/../c.md")).toBe("a/c.md");
  });

  it("refuses what resolveInsideRoot refuses", () => {
    expect(workspaceRelativePath("../escape.md")).toBeNull();
    expect(workspaceRelativePath("/etc/passwd")).toBeNull();
    expect(workspaceRelativePath("C:\\Windows\\system.ini")).toBeNull();
    expect(workspaceRelativePath("")).toBeNull();
  });
});
