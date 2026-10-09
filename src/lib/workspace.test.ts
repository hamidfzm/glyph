import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceLastFile, resolveWorkspace, setWorkspaceLastFile } from "./workspace";

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("workspace lib wrappers", () => {
  it("resolveWorkspace invokes workspace_resolve with the selected path", async () => {
    vi.mocked(invoke).mockResolvedValue({
      selected: "/p",
      isGitRepo: false,
      gitTopLevel: null,
      nestedUnder: null,
      glyphConflict: null,
    } as never);
    const r = await resolveWorkspace("/p");
    expect(invoke).toHaveBeenCalledWith("workspace_resolve", { selected: "/p" });
    expect(r.selected).toBe("/p");
  });

  it("getWorkspaceLastFile invokes workspace_get_last_file", async () => {
    vi.mocked(invoke).mockResolvedValue("/p/a.md" as never);
    const got = await getWorkspaceLastFile("/p");
    expect(invoke).toHaveBeenCalledWith("workspace_get_last_file", { workspaceRoot: "/p" });
    expect(got).toBe("/p/a.md");
  });

  it("setWorkspaceLastFile invokes workspace_set_last_file with root + file", async () => {
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    await setWorkspaceLastFile("/p", "/p/a.md");
    expect(invoke).toHaveBeenCalledWith("workspace_set_last_file", {
      workspaceRoot: "/p",
      filePath: "/p/a.md",
    });
  });
});
