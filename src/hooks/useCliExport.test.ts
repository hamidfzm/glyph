import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliExportRequestCache } from "@/lib/cliExport";
import { resetCliExportRunner, useCliExport } from "./useCliExport";

const exportSiteMock = vi.fn();
vi.mock("@/lib/export/site/exportSite", () => ({
  exportSite: (...args: unknown[]) => exportSiteMock(...args),
}));

function invokeCalls(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  exportSiteMock.mockReset().mockResolvedValue({ pages: 3, assets: 1 });
  resetCliExportRequestCache();
  resetCliExportRunner();
});

describe("useCliExport", () => {
  it("is a no-op on interactive launches", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("get_cli_export").length).toBe(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(invokeCalls("finish_cli_export")).toHaveLength(0);
  });

  it("exports the requested workspace and exits 0 with a summary", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_cli_export"
        ? Promise.resolve({ root: "/ws", outDir: "/out" })
        : Promise.resolve(undefined),
    );
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(exportSiteMock).toHaveBeenCalledWith({ root: "/ws", outDir: "/out", themes: [] });
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 0,
      message: "Exported 3 pages and 1 assets to /out",
    });
  });

  it("exits 1 with the failure message when the export throws", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_cli_export"
        ? Promise.resolve({ root: "/ws", outDir: "/out" })
        : Promise.resolve(undefined),
    );
    exportSiteMock.mockRejectedValue(new Error("no markdown files"));
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 1,
      message: "Website export failed: no markdown files",
    });
  });

  it("treats a failed get_cli_export probe as an interactive launch", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no tauri"));
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("get_cli_export").length).toBe(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(invokeCalls("finish_cli_export")).toHaveLength(0);
  });

  it("stringifies non-Error failures in the exit message", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_cli_export"
        ? Promise.resolve({ root: "/ws", outDir: "/out" })
        : Promise.resolve(undefined),
    );
    exportSiteMock.mockRejectedValue("string failure");
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 1,
      message: "Website export failed: string failure",
    });
  });

  it("runs the export only once even if the effect re-fires", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_cli_export"
        ? Promise.resolve({ root: "/ws", outDir: "/out" })
        : Promise.resolve(undefined),
    );
    const first = renderHook(() => useCliExport());
    first.unmount();
    renderHook(() => useCliExport());
    await waitFor(() => expect(invokeCalls("finish_cli_export").length).toBeGreaterThan(0));
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
  });
});
