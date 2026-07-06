import { describe, expect, it } from "vitest";
import { resolveInsideRoot } from "./workspacePath";

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
