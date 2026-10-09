import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOpen } from "@/lib/windowContext";
import { deferred } from "@/test/deferred";
import { useOpenRequests } from "./useOpenRequests";

type Handler = (event: { payload: string }) => void;

const defaultProps = {
  openFile: vi.fn(async () => undefined),
  openFolder: vi.fn(async () => {}),
};

/** Capture the handlers the hook registers, keyed by event name. */
function captureHandlers(): Record<string, Handler> {
  const handlers: Record<string, Handler> = {};
  vi.mocked(listen).mockImplementation(((name: string, handler: Handler) => {
    handlers[name] = handler;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  return handlers;
}

beforeEach(() => {
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue([]);
});

describe("useOpenRequests", () => {
  it("routes open-file and open-folder events to the callbacks", async () => {
    const handlers = captureHandlers();
    const openFile = vi.fn(async () => undefined);
    const openFolder = vi.fn(async () => {});
    renderHook(() => useOpenRequests({ openFile, openFolder }));

    handlers["open-file"]({ payload: "/p/note.md" });
    handlers["open-folder"]({ payload: "/p/ws" });

    await waitFor(() => expect(openFolder).toHaveBeenCalledWith("/p/ws"));
    expect(openFile).toHaveBeenCalledWith("/p/note.md");
  });

  it("keeps one pair of listeners and follows the latest callbacks", async () => {
    // Resubscribing on every new callback would leave a moment with no
    // listener, and an open emitted in it would reach nobody.
    const handlers = captureHandlers();
    const stale = vi.fn(async () => undefined);
    const current = vi.fn(async () => undefined);
    const { rerender } = renderHook((props) => useOpenRequests(props), {
      initialProps: { ...defaultProps, openFile: stale },
    });
    rerender({ ...defaultProps, openFile: current });

    handlers["open-file"]({ payload: "/p/note.md" });

    await waitFor(() => expect(current).toHaveBeenCalledWith("/p/note.md"));
    expect(listen).toHaveBeenCalledTimes(2);
    expect(stale).not.toHaveBeenCalled();
  });

  it("opens one request at a time, in arrival order", async () => {
    // A launch naming several files emits them back to back. Racing the loads
    // would let a small file's tab land ahead of a large one named before it.
    const handlers = captureHandlers();
    const firstLoad = deferred<undefined>();
    const openFile = vi.fn((path: string) =>
      path === "/p/a.md" ? firstLoad.promise : Promise.resolve(undefined),
    );
    renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    handlers["open-file"]({ payload: "/p/a.md" });
    handlers["open-file"]({ payload: "/p/b.md" });
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("/p/a.md"));
    expect(openFile).toHaveBeenCalledTimes(1);

    firstLoad.resolve(undefined);
    await waitFor(() => expect(openFile).toHaveBeenCalledTimes(2));
    expect(openFile).toHaveBeenLastCalledWith("/p/b.md");
  });

  it("keeps opening after a request that failed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const handlers = captureHandlers();
    const failure = new Error("unreadable");
    const openFolder = vi.fn(async () => {
      throw failure;
    });
    const openFile = vi.fn(async () => undefined);
    renderHook(() => useOpenRequests({ openFile, openFolder }));

    handlers["open-folder"]({ payload: "/p/gone" });
    handlers["open-file"]({ payload: "/p/a.md" });

    await waitFor(() => expect(openFile).toHaveBeenCalledWith("/p/a.md"));
    expect(logged).toHaveBeenCalledWith("Failed to open:", failure);
    logged.mockRestore();
  });

  it("detaches both listeners on unmount", async () => {
    const unlistenFile = vi.fn();
    const unlistenFolder = vi.fn();
    vi.mocked(listen).mockImplementation(((name: string) =>
      Promise.resolve(name === "open-file" ? unlistenFile : unlistenFolder)) as typeof listen);
    const { unmount } = renderHook(() => useOpenRequests(defaultProps));

    unmount();

    await waitFor(() => {
      expect(unlistenFile).toHaveBeenCalledTimes(1);
      expect(unlistenFolder).toHaveBeenCalledTimes(1);
    });
  });
});

describe("useOpenRequests startup", () => {
  it("opens the injected request, then the queue, in order", async () => {
    const queue: PendingOpen[] = [
      { kind: "folder", path: "/p/ws" },
      { kind: "file", path: "/p/a.md" },
    ];
    vi.mocked(invoke).mockResolvedValue(queue);
    const opened: string[] = [];
    const openFile = vi.fn(async (path: string) => {
      opened.push(path);
    });
    const openFolder = vi.fn(async (root?: string) => {
      opened.push(String(root));
    });
    const { result } = renderHook(() => useOpenRequests({ openFile, openFolder }));

    const hadRequests = await result.current.openStartupRequests({
      kind: "file",
      path: "/p/injected.md",
    });

    expect(hadRequests).toBe(true);
    expect(opened).toEqual(["/p/injected.md", "/p/ws", "/p/a.md"]);
  });

  it("reports that there was nothing to open", async () => {
    const { result } = renderHook(() => useOpenRequests(defaultProps));

    await expect(result.current.openStartupRequests(null)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("drains the queue only after both listeners are attached", async () => {
    const folderAttached = deferred<() => void>();
    vi.mocked(listen).mockImplementation(((name: string) =>
      name === "open-folder"
        ? folderAttached.promise
        : Promise.resolve(() => {})) as unknown as typeof listen);
    const { result } = renderHook(() => useOpenRequests(defaultProps));

    const started = result.current.openStartupRequests(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalled();

    folderAttached.resolve(() => {});
    await started;
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("waits for the listeners that stay attached after a StrictMode remount", async () => {
    // The first pair is torn down by the remount. Draining once it is ready
    // would switch the backend to emitting with no listener attached yet.
    const secondPair = deferred<() => void>();
    let registrations = 0;
    vi.mocked(listen).mockImplementation((() => {
      registrations += 1;
      return registrations <= 2 ? Promise.resolve(() => {}) : secondPair.promise;
    }) as unknown as typeof listen);
    let started: Promise<boolean> | null = null;
    renderHook(
      () => {
        const { openStartupRequests } = useOpenRequests(defaultProps);
        // Started from an effect, as the session init is: between the two mounts.
        useEffect(() => {
          started ??= openStartupRequests(null);
        }, [openStartupRequests]);
      },
      { wrapper: StrictMode },
    );
    expect(registrations).toBe(4);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalled();

    secondPair.resolve(() => {});
    await started;
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("drains even when a listener could not be attached", async () => {
    vi.mocked(listen).mockRejectedValue(new Error("no event system"));
    const { result } = renderHook(() => useOpenRequests(defaultProps));

    await expect(result.current.openStartupRequests(null)).resolves.toBe(false);
  });

  it("treats a queue it cannot read as empty", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("ipc broke"));
    const openFile = vi.fn(async () => undefined);
    const { result } = renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    const injected: PendingOpen = { kind: "file", path: "/p/injected.md" };
    await expect(result.current.openStartupRequests(injected)).resolves.toBe(true);
    expect(openFile).toHaveBeenCalledWith("/p/injected.md");
  });

  it("opens a request emitted while the queue is on its way after the queue", async () => {
    // The backend emits from the drain onward, and an event can overtake the
    // drain's own reply. It was requested later, so it must open later.
    const handlers = captureHandlers();
    const reply = deferred<PendingOpen[]>();
    vi.mocked(invoke).mockReturnValue(reply.promise);
    const opened: string[] = [];
    const openFile = vi.fn(async (path: string) => {
      opened.push(path);
    });
    const { result } = renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    const started = result.current.openStartupRequests(null);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("take_pending_opens"));
    handlers["open-file"]({ payload: "/p/late.md" });
    reply.resolve([{ kind: "file", path: "/p/queued.md" }]);
    await started;

    await waitFor(() => expect(opened).toEqual(["/p/queued.md", "/p/late.md"]));
  });
});
