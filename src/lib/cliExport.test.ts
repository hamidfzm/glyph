import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type CliExportRequest,
  getCliExportRequest,
  isCliExportProcess,
  resetCliExportRequestCache,
} from "./cliExport";

const REQUEST: CliExportRequest = {
  input: "/ws/notes.md",
  format: "pdf",
  output: "/ws/notes.pdf",
};

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  resetCliExportRequestCache();
});

describe("getCliExportRequest", () => {
  it("asks the backend once and reuses the answer", async () => {
    vi.mocked(invoke).mockResolvedValue(REQUEST);
    const first = await getCliExportRequest();
    const second = await getCliExportRequest();
    expect(first).toEqual(REQUEST);
    expect(second).toEqual(REQUEST);
    // The reveal gate and the export runner both ask; they must agree.
    expect(vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === "get_cli_export")).toHaveLength(
      1,
    );
  });

  it("resolves null outside Tauri instead of rejecting", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no tauri"));
    await expect(getCliExportRequest()).resolves.toBeNull();
    expect(isCliExportProcess()).toBe(false);
  });
});

describe("isCliExportProcess", () => {
  it("is false until the probe answers, then tracks it", async () => {
    vi.mocked(invoke).mockResolvedValue(REQUEST);
    expect(isCliExportProcess()).toBe(false);
    await getCliExportRequest();
    expect(isCliExportProcess()).toBe(true);
  });

  it("stays false on an interactive launch", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await getCliExportRequest();
    expect(isCliExportProcess()).toBe(false);
  });
});
