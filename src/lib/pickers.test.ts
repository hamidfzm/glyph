import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  pickExportDir,
  pickFiles,
  pickFolder,
  pickMoveDir,
  pickNewWorkspace,
  pickPluginDir,
  pickSave,
} from "./pickers";

describe("pickers", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("pickFolder invokes the backend picker and returns its path", async () => {
    vi.mocked(invoke).mockResolvedValue("/ws");
    await expect(pickFolder()).resolves.toBe("/ws");
    expect(invoke).toHaveBeenCalledWith("pick_folder");
  });

  it("pickFolder returns null when the dialog is cancelled", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(pickFolder()).resolves.toBeNull();
  });

  it("pickFiles forwards the filter list", async () => {
    vi.mocked(invoke).mockResolvedValue(["/a.md", "/b.md"]);
    const filters = [{ name: "Markdown", extensions: ["md"] }];
    await expect(pickFiles(filters)).resolves.toEqual(["/a.md", "/b.md"]);
    expect(invoke).toHaveBeenCalledWith("pick_files", { filters });
  });

  it("pickFiles uses the OS document picker on mobile (no Rust pick commands there)", async () => {
    const { platform } = await import("@tauri-apps/plugin-os");
    const { open } = await import("@tauri-apps/plugin-dialog");
    vi.mocked(platform).mockReturnValue("ios");
    vi.mocked(open).mockResolvedValue(["/picked.md"]);
    const filters = [{ name: "Markdown", extensions: ["md"] }];
    await expect(pickFiles(filters)).resolves.toEqual(["/picked.md"]);
    expect(open).toHaveBeenCalledWith({ multiple: true, filters });
    expect(invoke).not.toHaveBeenCalled();
    vi.mocked(platform).mockReturnValue("macos");
  });

  it("pickSave forwards name, filter label, and extensions", async () => {
    vi.mocked(invoke).mockResolvedValue("/out.pdf");
    await expect(pickSave("note.pdf", "PDF", ["pdf"])).resolves.toBe("/out.pdf");
    expect(invoke).toHaveBeenCalledWith("pick_save", {
      defaultName: "note.pdf",
      filterName: "PDF",
      extensions: ["pdf"],
    });
  });

  it("pickNewWorkspace forwards the default folder name", async () => {
    vi.mocked(invoke).mockResolvedValue("/p/new-ws");
    await expect(pickNewWorkspace("Untitled Workspace")).resolves.toBe("/p/new-ws");
    expect(invoke).toHaveBeenCalledWith("pick_new_workspace", {
      defaultName: "Untitled Workspace",
    });
  });

  it("pickExportDir invokes the export-dir picker", async () => {
    vi.mocked(invoke).mockResolvedValue("/site");
    await expect(pickExportDir()).resolves.toBe("/site");
    expect(invoke).toHaveBeenCalledWith("pick_export_dir");
  });

  it("pickPluginDir invokes the plugin-dir picker", async () => {
    vi.mocked(invoke).mockResolvedValue("/plugin-src");
    await expect(pickPluginDir()).resolves.toBe("/plugin-src");
    expect(invoke).toHaveBeenCalledWith("pick_plugin_dir");
  });

  it("pickMoveDir forwards the default directory", async () => {
    vi.mocked(invoke).mockResolvedValue("/ws/sub");
    await expect(pickMoveDir("/ws")).resolves.toBe("/ws/sub");
    expect(invoke).toHaveBeenCalledWith("pick_move_dir", { defaultDir: "/ws" });
  });
});
