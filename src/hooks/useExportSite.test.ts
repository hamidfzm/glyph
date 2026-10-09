import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import type { ExportSiteResult } from "@/lib/export/site/exportSite";
import { pickExportDir } from "@/lib/pickers";
import { createRegistry } from "@/lib/plugins/registry";
import { useExportSite } from "./useExportSite";

vi.mock("@/lib/pickers", () => ({
  pickExportDir: vi.fn(),
}));

const exportSiteMock = vi.fn();
vi.mock("@/lib/export/site/exportSite", () => ({
  exportSite: (...args: unknown[]) => exportSiteMock(...args),
}));

const EXPORTED: ExportSiteResult = { pages: 2, assets: 0, removed: 0, pruneError: null };

beforeEach(() => {
  vi.mocked(pickExportDir).mockReset();
  exportSiteMock.mockReset().mockResolvedValue(EXPORTED);
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

  it("refuses a destination inside the workspace, and says so", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/ws/site");
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(result.current.siteNotice).toEqual({ kind: "insideWorkspace" });
  });

  it("raises no notice for an export that ran clean", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteNotice).toBeNull();
  });

  it("warns when the site exported but its cleanup failed", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    const unrecorded = "Failed to write .glyph/site-manifest.json: locked";
    exportSiteMock.mockResolvedValue({ ...EXPORTED, pruneError: unrecorded });
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteProgress).toBeNull();
    expect(result.current.siteNotice).toEqual({ kind: "pruneFailed", reason: unrecorded });
  });

  it("keeps the notice up until it is dismissed", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/ws/site");
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    // A cancelled picker is not a new export: the notice has not been read yet.
    vi.mocked(pickExportDir).mockResolvedValue(null);
    await act(() => result.current.exportWebsite());
    expect(result.current.siteNotice).not.toBeNull();

    act(() => result.current.dismissSiteNotice());
    expect(result.current.siteNotice).toBeNull();
  });

  it("ignores a second export while one is in flight", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    let finish: ((result: ExportSiteResult) => void) | undefined;
    exportSiteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useExportSite("/ws"));
    act(() => {
      void result.current.exportWebsite();
    });
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));

    // Starting another would clear the first one's warning before it was read.
    await act(() => result.current.exportWebsite());
    expect(pickExportDir).toHaveBeenCalledTimes(1);

    await act(async () => finish?.({ ...EXPORTED, pruneError: "locked" }));
    expect(result.current.siteNotice).toEqual({ kind: "pruneFailed", reason: "locked" });

    // The latch releases with the export, so the next one runs.
    await act(() => result.current.exportWebsite());
    expect(pickExportDir).toHaveBeenCalledTimes(2);
  });

  it("ignores a second export while the folder picker is still open", async () => {
    let pick: ((dir: string | null) => void) | undefined;
    vi.mocked(pickExportDir).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          pick = resolve;
        }),
    );
    const { result } = renderHook(() => useExportSite("/ws"));
    act(() => {
      void result.current.exportWebsite();
    });
    await act(() => result.current.exportWebsite());
    expect(pickExportDir).toHaveBeenCalledTimes(1);
    await act(async () => pick?.(null));
  });

  it.each([
    ["a cancelled picker", () => vi.mocked(pickExportDir).mockResolvedValueOnce(null)],
    ["a refused destination", () => vi.mocked(pickExportDir).mockResolvedValueOnce("/ws/site")],
    ["a picker that failed", () => vi.mocked(pickExportDir).mockRejectedValueOnce("no dialog")],
    ["a failed export", () => exportSiteMock.mockRejectedValueOnce(new Error("boom"))],
  ])("runs the next export after %s", async (_name, arrange) => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    arrange();
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());

    // An attempt that ended early must not leave every later one ignored.
    exportSiteMock.mockClear();
    await act(() => result.current.exportWebsite());
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
    expect(result.current.siteNotice).toBeNull();
    error.mockRestore();
  });

  it("still reports an export whose workspace was switched away mid-run", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    let finish: ((result: ExportSiteResult) => void) | undefined;
    exportSiteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ root }) => useExportSite(root), {
      initialProps: { root: "/ws" },
    });
    act(() => {
      void result.current.exportWebsite();
    });
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));

    rerender({ root: "/other" });
    await act(async () => finish?.({ ...EXPORTED, pruneError: "locked" }));
    // The user started it, so its outcome is still theirs to read.
    expect(result.current.siteNotice).toEqual({ kind: "pruneFailed", reason: "locked" });
  });

  it("treats an empty reason as a failed cleanup all the same", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    exportSiteMock.mockResolvedValue({ ...EXPORTED, pruneError: "" });
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteNotice).toEqual({ kind: "pruneFailed", reason: "" });
  });

  it("reports a picker that could not open instead of failing silently", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pickExportDir).mockRejectedValue("dialog unavailable");
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteNotice).toEqual({ kind: "failed", reason: "dialog unavailable" });
    error.mockRestore();
  });

  it("drops the previous notice when the next export starts", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    exportSiteMock.mockResolvedValueOnce({ ...EXPORTED, pruneError: "locked" });
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteNotice).not.toBeNull();

    exportSiteMock.mockImplementationOnce(() => new Promise(() => {})); // in flight
    act(() => {
      void result.current.exportWebsite();
    });
    // Gone while the new export runs, not only once it ends.
    await waitFor(() => expect(result.current.siteProgress).not.toBeNull());
    expect(result.current.siteNotice).toBeNull();
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

  it("clears progress and reports the reason when the export fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    exportSiteMock.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useExportSite("/ws"));
    await act(() => result.current.exportWebsite());
    expect(result.current.siteProgress).toBeNull();
    expect(result.current.siteNotice).toEqual({ kind: "failed", reason: "boom" });
    expect(error).toHaveBeenCalledWith("Failed to export website:", expect.any(Error));
    error.mockRestore();
  });

  it("passes plugin markdown contributions to the exporter", async () => {
    vi.mocked(pickExportDir).mockResolvedValue("/out");
    const remark = [vi.fn()];
    const rehype = [vi.fn()];
    const siteThemes = createRegistry();
    const remarkPlugins = createRegistry();
    const rehypePlugins = createRegistry();
    remarkPlugins.register(remark[0]);
    rehypePlugins.register(rehype[0]);
    const value = { siteThemes, remarkPlugins, rehypePlugins } as unknown as PluginsContextValue;
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(PluginsContext.Provider, { value }, children);
    const { result } = renderHook(() => useExportSite("/ws"), { wrapper });
    await act(() => result.current.exportWebsite());
    expect(exportSiteMock).toHaveBeenCalledWith(
      expect.objectContaining({ remarkPlugins: remark, rehypePlugins: rehype }),
    );
  });
});
