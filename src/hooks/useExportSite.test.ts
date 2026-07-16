import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickExportDir } from "@/lib/pickers";
import { useExportSite } from "./useExportSite";

vi.mock("@/lib/pickers", () => ({
  pickExportDir: vi.fn(),
}));

const exportSiteMock = vi.fn();
vi.mock("@/lib/export/site/exportSite", () => ({
  exportSite: (...args: unknown[]) => exportSiteMock(...args),
}));

beforeEach(() => {
  vi.mocked(pickExportDir).mockReset();
  exportSiteMock.mockReset().mockResolvedValue({ pages: 2, assets: 0 });
});

describe("useExportSite", () => {
  it("does nothing without a workspace root", async () => {
    const { result } = renderHook(() => useExportSite(undefined));
    await act(() => result.current.exportWebsite());
    expect(pickExportDir).not.toHaveBeenCalled();
    expect(exportSiteMock).not.toHaveBeenCalled();
  });

  it("aborts when the folder picker is cancelled", async () => {
    vi.mocked(pickExportDir).mockResolvedValue(null);
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(pickExportDir).toHaveBeenCalled();
    expect(exportSiteMock).not.toHaveBeenCalled();
  });

  it("refuses a destination inside the workspace", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pickExportDir).mockResolvedValue("/ws/site");
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("runs the export and surfaces determinate progress", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    let capturedProgress: ((done: number, total: number) => void) | undefined;
    exportSiteMock.mockImplementation(
      (opts: { onProgress: (done: number, total: number) => void }) => {
        capturedProgress = opts.onProgress;
        return new Promise(() => {}); // keep the export in flight
      },
    );
    const { result } = renderHook(() => useExportSite("/ws"));
    act(() => {
      void result.current.exportWebsite();
    });
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalled());
    expect(exportSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ root: "/ws", outDir: "/out" }),
    );
    act(() => capturedProgress?.(3, 7));
    expect(result.current.siteProgress).toEqual({ done: 3, total: 7 });
  });

  it("clears progress and logs when the export fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    exportSiteMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteProgress).toBeNull();
    expect(error).toHaveBeenCalledWith("Failed to export website:", expect.any(Error));
    error.mockRestore();
  });
});
