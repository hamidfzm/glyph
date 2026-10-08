import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDailyNote,
  getDailyNotesSettings,
  getWorkspaceLastFile,
  resolveWorkspace,
  setDailyNotesSettings,
  setWorkspaceLastFile,
} from "./workspace";

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

  it("getDailyNotesSettings invokes workspace_get_daily_notes", async () => {
    const settings = { folder: "daily", filenamePattern: "YYYY-MM-DD.md" };
    vi.mocked(invoke).mockResolvedValue(settings as never);
    expect(await getDailyNotesSettings("/p")).toEqual(settings);
    expect(invoke).toHaveBeenCalledWith("workspace_get_daily_notes", { workspaceRoot: "/p" });
  });

  it("setDailyNotesSettings invokes workspace_set_daily_notes with root + settings", async () => {
    const settings = { folder: "journal", filenamePattern: "DD.md", template: "t.md" };
    vi.mocked(invoke).mockResolvedValue(undefined as never);
    await setDailyNotesSettings("/p", settings);
    expect(invoke).toHaveBeenCalledWith("workspace_set_daily_notes", {
      workspaceRoot: "/p",
      settings,
    });
  });

  it("createDailyNote invokes create_daily_note with the relative path and template", async () => {
    const note = { path: "/p/daily/2026-10-08.md", created: true };
    vi.mocked(invoke).mockResolvedValue(note as never);
    expect(await createDailyNote("/p", "daily/2026-10-08.md", null)).toEqual(note);
    expect(invoke).toHaveBeenCalledWith("create_daily_note", {
      root: "/p",
      path: "daily/2026-10-08.md",
      template: null,
    });
  });
});
