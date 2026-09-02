import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetCliServeRequestCache } from "@/lib/cliServe";
import { resetCliServeRunner, SERVE_CHANGED_EVENT, useCliServe } from "./useCliServe";

const exportSiteMock = vi.fn();
vi.mock("@/lib/export/site/exportSite", () => ({
  exportSite: (...args: unknown[]) => exportSiteMock(...args),
}));

// Stubbed open so the serve loop itself is what is under test; the gate has
// its own tests in useExportReadiness.test.ts.
vi.mock("@/hooks/useExportReadiness", () => ({
  useExportReadiness: () => ({
    ready: true,
    themes: [],
    remarkPlugins: [],
    rehypePlugins: [],
  }),
}));

const REQUEST = { root: "/ws", outDir: "/tmp/glyph-serve-1" };

/** Fires whatever the hook registered for the change event. */
let emitChange: (() => void) | undefined;
const unlistenMock = vi.fn();

function stubServe(request: unknown) {
  vi.mocked(invoke).mockImplementation((cmd: string) =>
    cmd === "get_cli_serve" ? Promise.resolve(request) : Promise.resolve(undefined),
  );
}

function invokeCalls(command: string) {
  return vi.mocked(invoke).mock.calls.filter(([cmd]) => cmd === command);
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockReset();
  unlistenMock.mockReset();
  emitChange = undefined;
  vi.mocked(listen).mockImplementation((event, handler) => {
    if (event === SERVE_CHANGED_EVENT) {
      emitChange = () => handler({ event, id: 1, payload: "/ws" });
    }
    return Promise.resolve(unlistenMock);
  });
  exportSiteMock.mockReset().mockResolvedValue({ pages: 3, assets: 1 });
  resetCliServeRequestCache();
  resetCliServeRunner();
});

describe("useCliServe", () => {
  it("renders the site once on mount and reports it ready", async () => {
    stubServe(REQUEST);
    renderHook(() => useCliServe());

    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(1));
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
    expect(exportSiteMock.mock.calls[0][0]).toMatchObject({
      root: "/ws",
      outDir: "/tmp/glyph-serve-1",
    });
  });

  it("does nothing on a launch that is not a serve", async () => {
    stubServe(null);
    renderHook(() => useCliServe());

    await waitFor(() => expect(invokeCalls("get_cli_serve")).toHaveLength(1));
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(invokeCalls("serve_ready")).toHaveLength(0);
  });

  it("re-renders the site when the folder changes", async () => {
    stubServe(REQUEST);
    renderHook(() => useCliServe());
    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(1));

    emitChange?.();
    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(2));
    expect(exportSiteMock).toHaveBeenCalledTimes(2);
  });

  it("collapses changes that arrive mid-build into one extra build", async () => {
    stubServe(REQUEST);
    // Hold the first build open so the changes land while it is running.
    let releaseFirst: (() => void) | undefined;
    exportSiteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () => resolve({ pages: 1, assets: 0 });
        }),
    );
    renderHook(() => useCliServe());
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));

    emitChange?.();
    emitChange?.();
    emitChange?.();
    releaseFirst?.();

    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(2));
    // Three changes during one build are one rebuild, not three: the export
    // reads the whole folder, so a single pass covers all of them.
    expect(exportSiteMock).toHaveBeenCalledTimes(2);
  });

  it("reports a failed build without telling browsers to reload", async () => {
    stubServe(REQUEST);
    exportSiteMock.mockRejectedValueOnce(new Error("bad site.json"));
    renderHook(() => useCliServe());

    await waitFor(() => expect(invokeCalls("serve_failed")).toHaveLength(1));
    expect(invokeCalls("serve_failed")[0][1]).toEqual({
      message: "Rebuild failed: bad site.json",
    });
    // The previous site is still on disk and still served, so nothing reloads.
    expect(invokeCalls("serve_ready")).toHaveLength(0);
  });

  it("reports a rejection that is not an Error", async () => {
    stubServe(REQUEST);
    exportSiteMock.mockRejectedValueOnce("site.json is not valid JSON");
    renderHook(() => useCliServe());

    await waitFor(() => expect(invokeCalls("serve_failed")).toHaveLength(1));
    expect(invokeCalls("serve_failed")[0][1]).toEqual({
      message: "Rebuild failed: site.json is not valid JSON",
    });
  });

  it("keeps serving after a failed build", async () => {
    stubServe(REQUEST);
    exportSiteMock.mockRejectedValueOnce(new Error("transient"));
    renderHook(() => useCliServe());
    await waitFor(() => expect(invokeCalls("serve_failed")).toHaveLength(1));

    emitChange?.();
    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(1));
  });

  it("does not report a build that finished after unmount", async () => {
    // The export is derived output, so finishing is harmless, but telling
    // Rust to reload browsers for a process that is going away is not.
    stubServe(REQUEST);
    let releaseBuild: (() => void) | undefined;
    exportSiteMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseBuild = () => resolve({ pages: 1, assets: 0 });
        }),
    );

    const { unmount } = renderHook(() => useCliServe());
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));
    // A change lands mid-build and queues a rebuild, then the shell goes
    // away: the queued pass must not start either.
    emitChange?.();
    unmount();
    releaseBuild?.();

    await waitFor(() => expect(unlistenMock).toHaveBeenCalled());
    expect(invokeCalls("serve_ready")).toHaveLength(0);
    expect(exportSiteMock).toHaveBeenCalledTimes(1);
  });

  it("does not report a failure that landed after unmount", async () => {
    stubServe(REQUEST);
    let rejectBuild: ((err: Error) => void) | undefined;
    exportSiteMock.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectBuild = reject;
        }),
    );

    const { unmount } = renderHook(() => useCliServe());
    await waitFor(() => expect(exportSiteMock).toHaveBeenCalledTimes(1));
    unmount();
    rejectBuild?.(new Error("too late"));

    await waitFor(() => expect(unlistenMock).toHaveBeenCalled());
    expect(invokeCalls("serve_failed")).toHaveLength(0);
  });

  it("does not build or leak a listener when unmounted mid-setup", async () => {
    // Unmounting between `listen` resolving and the first build would
    // otherwise leave a live listener rebuilding a site nobody serves.
    stubServe(REQUEST);
    let resolveListen: ((unlisten: () => void) => void) | undefined;
    vi.mocked(listen).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveListen = resolve as (unlisten: () => void) => void;
        }),
    );

    const { unmount } = renderHook(() => useCliServe());
    await waitFor(() => expect(resolveListen).toBeDefined());
    unmount();
    resolveListen?.(unlistenMock);

    await waitFor(() => expect(unlistenMock).toHaveBeenCalled());
    expect(exportSiteMock).not.toHaveBeenCalled();
    expect(invokeCalls("serve_ready")).toHaveLength(0);
  });

  it("stops listening when the shell unmounts", async () => {
    stubServe(REQUEST);
    const { unmount } = renderHook(() => useCliServe());
    await waitFor(() => expect(invokeCalls("serve_ready")).toHaveLength(1));

    unmount();
    expect(unlistenMock).toHaveBeenCalled();
  });
});
