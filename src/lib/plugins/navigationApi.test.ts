import { beforeEach, describe, expect, it, vi } from "vitest";
import { createNavigationApi, setPluginFileOpener } from "./navigationApi";

const open = vi.fn();

beforeEach(() => {
  open.mockReset();
  setPluginFileOpener(open);
});

describe("createNavigationApi", () => {
  it("opens an absolute path inside the workspace, as the vault returns them", () => {
    createNavigationApi(() => "/ws").openFile("/ws/notes/a.md");
    expect(open).toHaveBeenCalledExactlyOnceWith("/ws/notes/a.md", undefined);
  });

  it("resolves a workspace-relative path and passes the line on", () => {
    createNavigationApi(() => "/ws").openFile("notes/a.md", { line: 12 });
    expect(open).toHaveBeenCalledExactlyOnceWith("/ws/notes/a.md", 12);
  });

  // The tabs know a file by one spelling of its path; a second spelling would
  // open a second edit buffer over the same file.
  it.each([
    ["mixed separators", "C:\\ws", "C:\\ws/notes/a.md", "C:\\ws\\notes\\a.md"],
    ["a doubled separator", "/ws", "/ws//notes/a.md", "/ws/notes/a.md"],
    ["a dot segment", "/ws", "/ws/./notes/a.md", "/ws/notes/a.md"],
    ["a parent segment that stays inside", "/ws", "/ws/notes/../a.md", "/ws/a.md"],
  ])("normalizes an absolute path with %s", (_case, root, path, expected) => {
    createNavigationApi(() => root).openFile(path);
    expect(open).toHaveBeenCalledExactlyOnceWith(expected, undefined);
  });

  // A workspace opened at a drive root already ends in its separator.
  it.each([
    ["a Windows drive root", "D:\\", "D:\\notes\\a.md", "D:\\notes\\a.md"],
    ["the filesystem root", "/", "/notes/a.md", "/notes/a.md"],
    ["a root written with a trailing separator", "/ws/", "/ws/a.md", "/ws/a.md"],
  ])("opens a file under %s", (_case, root, path, expected) => {
    createNavigationApi(() => root).openFile(path);
    expect(open).toHaveBeenCalledExactlyOnceWith(expected, undefined);
  });

  it.each([
    ["an absolute path elsewhere", "/ws", "/etc/passwd"],
    ["a sibling folder sharing the prefix", "/ws", "/ws-other/a.md"],
    ["a relative path climbing out", "/ws", "../outside.md"],
    ["an absolute path climbing out", "/ws", "/ws/../etc/passwd"],
    ["the workspace root itself", "/ws", "/ws"],
    ["the workspace root with a trailing separator", "/ws", "/ws/"],
    ["a Windows path climbing out", "C:\\ws", "C:\\ws\\..\\x.md"],
    ["a Windows path on another drive", "C:\\ws", "D:\\ws\\a.md"],
    ["a mixed-separator path climbing out", "C:\\ws", "C:\\ws/notes\\..\\..\\x.md"],
  ])("refuses %s", (_case, root, path) => {
    const api = createNavigationApi(() => root);
    expect(() => api.openFile(path)).toThrow(/outside the workspace/);
    expect(open).not.toHaveBeenCalled();
  });

  it("refuses when no workspace is open", () => {
    const api = createNavigationApi(() => null);
    expect(() => api.openFile("/ws/a.md")).toThrow(/no workspace/);
    expect(open).not.toHaveBeenCalled();
  });

  it("does nothing while the app has no opener mounted", () => {
    setPluginFileOpener(null);
    expect(() => createNavigationApi(() => "/ws").openFile("/ws/a.md")).not.toThrow();
  });
});
