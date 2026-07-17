import { invoke } from "@tauri-apps/api/core";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PluginsContext, type PluginsContextValue } from "@/contexts/PluginsContext";
import { resetCliExportRequestCache } from "@/lib/cliExport";
import { createRegistry } from "@/lib/plugins/registry";
import { CLI_PLUGIN_WAIT_MS, resetCliExportRunner, useCliExport } from "./useCliExport";

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

// Only the fields useCliExport reads; the full provider surface is
// irrelevant to the readiness gate under test.
function pluginsStub(initialLoadDone: boolean): PluginsContextValue {
  return { siteThemes: createRegistry(), initialLoadDone } as unknown as PluginsContextValue;
}

function providerWrapper(initialLoadDone: boolean) {
  return ({ children }: { children: ReactNode }) =>
    createElement(PluginsContext.Provider, { value: pluginsStub(initialLoadDone) }, children);
}

describe("useCliExport", () => {
  it("waits for the plugin startup load, then exports", async () => {
    vi.mocked(invoke).mockImplementation((cmd: string) =>
      cmd === "get_cli_export"
        ? Promise.resolve({ root: "/ws", outDir: "/out" })
        : Promise.resolve(undefined),
    );
    const { unmount } = renderHook(() => useCliExport(), { wrapper: providerWrapper(false) });
    // Not ready: the export must not even probe for a request.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invokeCalls("get_cli_export")).toHaveLength(0);
    unmount();

    renderHook(() => useCliExport(), { wrapper: providerWrapper(true) });
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
  });

  it("gives up waiting after the timeout so a hung plugin cannot hang CI", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockImplementation((cmd: string) =>
        cmd === "get_cli_export"
          ? Promise.resolve({ root: "/ws", outDir: "/out" })
          : Promise.resolve(undefined),
      );
      renderHook(() => useCliExport(), { wrapper: providerWrapper(false) });
      await vi.advanceTimersByTimeAsync(CLI_PLUGIN_WAIT_MS + 1);
      await vi.waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });

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
    // No provider: themes and plugin markdown contributions are all empty.
    expect(exportSiteMock).toHaveBeenCalledWith({
      root: "/ws",
      outDir: "/out",
      themes: [],
      remarkPlugins: [],
      rehypePlugins: [],
    });
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
