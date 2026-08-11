import { invoke } from "@tauri-apps/api/core";
import { act, renderHook, waitFor } from "@testing-library/react";
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

const runCliDocumentExportMock = vi.fn();
vi.mock("@/lib/export/cliDocumentExport", () => ({
  runCliDocumentExport: (...args: unknown[]) => runCliDocumentExportMock(...args),
}));

// No SettingsProvider in these renders, and the context default reports
// `loaded: false`, which is the gate the runner waits on.
const settings = { loaded: true, settings: { print: { includeToc: true } } };
vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => settings,
}));

const SITE_REQUEST = { input: "/ws", format: "site", output: "/out" };
const PDF_REQUEST = { input: "/ws/notes.md", format: "pdf", output: "/ws/notes.pdf" };

function stubRequest(request: unknown) {
  vi.mocked(invoke).mockImplementation((cmd: string) =>
    cmd === "get_cli_export" ? Promise.resolve(request) : Promise.resolve(undefined),
  );
}

function invokeCalls(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command);
}

const HOOK_ARGS = { entries: [], content: "# Notes" };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  exportSiteMock.mockReset().mockResolvedValue({ pages: 3, assets: 1 });
  runCliDocumentExportMock.mockReset().mockResolvedValue({ path: "/ws/notes.pdf", settled: true });
  settings.loaded = true;
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
    stubRequest(SITE_REQUEST);
    const { unmount } = renderHook(() => useCliExport(HOOK_ARGS), {
      wrapper: providerWrapper(false),
    });
    // Not ready: the export must not even probe for a request.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invokeCalls("get_cli_export")).toHaveLength(0);
    unmount();

    renderHook(() => useCliExport(HOOK_ARGS), { wrapper: providerWrapper(true) });
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
  });

  it("waits for persisted settings, which carry the export options", async () => {
    settings.loaded = false;
    stubRequest(PDF_REQUEST);
    renderHook(() => useCliExport(HOOK_ARGS));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invokeCalls("get_cli_export")).toHaveLength(0);
  });

  it("gives up waiting after the timeout so a hung plugin cannot hang CI", async () => {
    vi.useFakeTimers();
    try {
      stubRequest(SITE_REQUEST);
      renderHook(() => useCliExport(HOOK_ARGS), { wrapper: providerWrapper(false) });
      // The expiring timer sets state, so the advance must run inside act.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLI_PLUGIN_WAIT_MS + 1);
      });
      await vi.waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op on interactive launches", async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("get_cli_export").length).toBe(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(runCliDocumentExportMock).not.toHaveBeenCalled();
    expect(invokeCalls("finish_cli_export")).toHaveLength(0);
  });

  it("exports the requested workspace and exits 0 with a summary", async () => {
    stubRequest(SITE_REQUEST);
    renderHook(() => useCliExport(HOOK_ARGS));
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

  it("exports a document format through the shared document exporter", async () => {
    stubRequest(PDF_REQUEST);
    renderHook(() => useCliExport({ entries: [], content: "# Notes" }));
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(runCliDocumentExportMock).toHaveBeenCalledWith(PDF_REQUEST, {
      entries: [],
      // Straight from the persisted print settings.
      includeToc: true,
      content: "# Notes",
    });
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 0,
      message: "Exported /ws/notes.pdf",
    });
  });

  it("says so when a document exported before it finished rendering", async () => {
    stubRequest(PDF_REQUEST);
    runCliDocumentExportMock.mockResolvedValue({ path: "/ws/notes.pdf", settled: false });
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 0,
      message:
        "Exported /ws/notes.pdf (the document did not finish rendering; diagrams may be missing)",
    });
  });

  it("exits 1 with the failure message when the export throws", async () => {
    stubRequest(SITE_REQUEST);
    exportSiteMock.mockRejectedValue(new Error("no markdown files"));
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 1,
      message: "Export failed: no markdown files",
    });
  });

  it("exits 1 when a document export throws", async () => {
    stubRequest(PDF_REQUEST);
    runCliDocumentExportMock.mockRejectedValue(new Error("did not finish rendering"));
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 1,
      message: "Export failed: did not finish rendering",
    });
  });

  it("treats a failed get_cli_export probe as an interactive launch", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("no tauri"));
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("get_cli_export").length).toBe(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(invokeCalls("finish_cli_export")).toHaveLength(0);
  });

  it("stringifies non-Error failures in the exit message", async () => {
    stubRequest(SITE_REQUEST);
    exportSiteMock.mockRejectedValue("string failure");
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("finish_cli_export")).toHaveLength(1));
    expect(invokeCalls("finish_cli_export")[0][1]).toEqual({
      code: 1,
      message: "Export failed: string failure",
    });
  });

  it("runs the export only once even if the effect re-fires", async () => {
    stubRequest(SITE_REQUEST);
    const first = renderHook(() => useCliExport(HOOK_ARGS));
    first.unmount();
    renderHook(() => useCliExport(HOOK_ARGS));
    await waitFor(() => expect(invokeCalls("finish_cli_export").length).toBeGreaterThan(0));
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
  });
});
