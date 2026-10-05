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

  it("keeps the workspace's own separators", () => {
    createNavigationApi(() => "C:\\ws").openFile("C:\\ws\\notes\\a.md");
    expect(open).toHaveBeenCalledExactlyOnceWith("C:\\ws\\notes\\a.md", undefined);
  });

  it.each([
    ["an absolute path elsewhere", "/etc/passwd"],
    ["a sibling folder sharing the prefix", "/ws-other/a.md"],
    ["a relative path climbing out", "../outside.md"],
    ["an absolute path climbing out", "/ws/../etc/passwd"],
    ["the workspace root itself", "/ws"],
  ])("refuses %s", (_case, path) => {
    const api = createNavigationApi(() => "/ws");
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
