import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { renderHook, waitFor } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingOpen } from "@/lib/windowContext";
import { deferred } from "@/test/deferred";
import { useOpenRequests } from "./useOpenRequests";

const defaultProps = {
  openFile: vi.fn(async () => undefined),
  openFolder: vi.fn(async () => {}),
};

const file = (path: string): PendingOpen => ({ kind: "file", path });

/** Capture the nudge handler the hook registers. */
function captureNudge(): { nudge: () => void } {
  const captured = { nudge: () => {} };
  vi.mocked(listen).mockImplementation(((_name: string, handler: () => void) => {
    captured.nudge = handler;
    return Promise.resolve(() => {});
  }) as unknown as typeof listen);
  return captured;
}

/** Answer each `take_pending_opens` with the next batch, then with nothing. */
function queueBatches(...batches: PendingOpen[][]): void {
  vi.mocked(invoke).mockImplementation((async () => batches.shift() ?? []) as typeof invoke);
}

beforeEach(() => {
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(() => {});
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue([]);
});

describe("useOpenRequests", () => {
  it("takes its queue when nudged and opens it in order", async () => {
    const captured = captureNudge();
    queueBatches([{ kind: "folder", path: "/p/ws" }, file("/p/a.md"), file("/p/b.md")]);
    const opened: string[] = [];
    const openFile = vi.fn(async (path: string) => {
      opened.push(path);
    });
    const openFolder = vi.fn(async (root?: string) => {
      opened.push(String(root));
    });
    renderHook(() => useOpenRequests({ openFile, openFolder }));

    captured.nudge();

    await waitFor(() => expect(opened).toEqual(["/p/ws", "/p/a.md", "/p/b.md"]));
    expect(vi.mocked(listen).mock.calls[0][0]).toBe("opens-pending");
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("keeps one listener and follows the latest callbacks", async () => {
    // Resubscribing on every new callback would leave a moment with no
    // listener, and a nudge emitted in it would reach nobody.
    const captured = captureNudge();
    queueBatches([file("/p/note.md")]);
    const stale = vi.fn(async () => undefined);
    const current = vi.fn(async () => undefined);
    const { rerender } = renderHook((props) => useOpenRequests(props), {
      initialProps: { ...defaultProps, openFile: stale },
    });
    rerender({ ...defaultProps, openFile: current });

    captured.nudge();

    await waitFor(() => expect(current).toHaveBeenCalledWith("/p/note.md"));
    expect(listen).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
  });

  it("finishes one batch before taking the next", async () => {
    // Two launches back to back. Racing their loads would let the second
    // launch's tab land ahead of a slow file from the first.
    const captured = captureNudge();
    queueBatches([file("/p/a.md")], [file("/p/b.md")]);
    const firstLoad = deferred<undefined>();
    const openFile = vi.fn((path: string) =>
      path === "/p/a.md" ? firstLoad.promise : Promise.resolve(undefined),
    );
    renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    captured.nudge();
    captured.nudge();
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("/p/a.md"));
    expect(invoke).toHaveBeenCalledTimes(1);

    firstLoad.resolve(undefined);
    await waitFor(() => expect(openFile).toHaveBeenLastCalledWith("/p/b.md"));
    expect(openFile).toHaveBeenCalledTimes(2);
  });

  it("keeps opening after a request that failed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const captured = captureNudge();
    queueBatches([{ kind: "folder", path: "/p/gone" }, file("/p/a.md")]);
    const failure = new Error("unreadable");
    const openFolder = vi.fn(async () => {
      throw failure;
    });
    const openFile = vi.fn(async () => undefined);
    renderHook(() => useOpenRequests({ openFile, openFolder }));

    captured.nudge();

    await waitFor(() => expect(openFile).toHaveBeenCalledWith("/p/a.md"));
    expect(logged).toHaveBeenCalledWith("Failed to open:", failure);
    logged.mockRestore();
  });

  it("treats a queue it cannot read as empty and keeps listening", async () => {
    const captured = captureNudge();
    vi.mocked(invoke).mockRejectedValueOnce(new Error("ipc broke"));
    const openFile = vi.fn(async () => undefined);
    renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    captured.nudge();
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    expect(openFile).not.toHaveBeenCalled();

    vi.mocked(invoke).mockResolvedValueOnce([file("/p/a.md")]);
    captured.nudge();
    await waitFor(() => expect(openFile).toHaveBeenCalledWith("/p/a.md"));
  });

  it("detaches the listener on unmount", async () => {
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    const { unmount } = renderHook(() => useOpenRequests(defaultProps));

    unmount();

    await waitFor(() => expect(unlisten).toHaveBeenCalledTimes(1));
  });
});

describe("useOpenRequests startup", () => {
  it("opens the injected request, then the queue, in order", async () => {
    queueBatches([{ kind: "folder", path: "/p/ws" }, file("/p/a.md")]);
    const opened: string[] = [];
    const openFile = vi.fn(async (path: string) => {
      opened.push(path);
    });
    const openFolder = vi.fn(async (root?: string) => {
      opened.push(String(root));
    });
    const { result } = renderHook(() => useOpenRequests({ openFile, openFolder }));

    const hadRequests = await result.current.openStartupRequests(file("/p/injected.md"));

    expect(hadRequests).toBe(true);
    expect(opened).toEqual(["/p/injected.md", "/p/ws", "/p/a.md"]);
  });

  it("reports that there was nothing to open", async () => {
    const { result } = renderHook(() => useOpenRequests(defaultProps));

    await expect(result.current.openStartupRequests(null)).resolves.toBe(false);
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("takes the queue only after the listener is attached", async () => {
    // An open queued between an early take and a late listener would have its
    // nudge go unheard, and would sit in the queue until the next launch.
    const attached = deferred<() => void>();
    vi.mocked(listen).mockReturnValue(attached.promise);
    const { result } = renderHook(() => useOpenRequests(defaultProps));

    const started = result.current.openStartupRequests(null);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalled();

    attached.resolve(() => {});
    await started;
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("waits for the listener that stays attached after a StrictMode remount", async () => {
    // The first one is torn down by the remount, so it does not count.
    const second = deferred<() => void>();
    let registrations = 0;
    vi.mocked(listen).mockImplementation((() => {
      registrations += 1;
      return registrations === 1 ? Promise.resolve(() => {}) : second.promise;
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
    expect(registrations).toBe(2);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(invoke).not.toHaveBeenCalled();

    second.resolve(() => {});
    await started;
    expect(invoke).toHaveBeenCalledWith("take_pending_opens");
  });

  it("takes the queue even when the listener could not be attached", async () => {
    vi.mocked(listen).mockRejectedValue(new Error("no event system"));
    queueBatches([file("/p/a.md")]);
    const openFile = vi.fn(async () => undefined);
    const { result } = renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    await expect(result.current.openStartupRequests(null)).resolves.toBe(true);
    expect(openFile).toHaveBeenCalledWith("/p/a.md");
  });

  it("still opens the injected request when the queue cannot be read", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("ipc broke"));
    const openFile = vi.fn(async () => undefined);
    const { result } = renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    await expect(result.current.openStartupRequests(file("/p/injected.md"))).resolves.toBe(true);
    expect(openFile).toHaveBeenCalledWith("/p/injected.md");
  });

  it("opens what a nudge during startup brings after the startup queue", async () => {
    // A launch forwarded while the first queue is still on its way here was
    // requested later, so it opens later.
    const captured = captureNudge();
    const reply = deferred<PendingOpen[]>();
    vi.mocked(invoke)
      .mockReturnValueOnce(reply.promise)
      .mockResolvedValueOnce([file("/p/late.md")]);
    const opened: string[] = [];
    const openFile = vi.fn(async (path: string) => {
      opened.push(path);
    });
    const { result } = renderHook(() => useOpenRequests({ ...defaultProps, openFile }));

    const started = result.current.openStartupRequests(null);
    await waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
    captured.nudge();
    reply.resolve([file("/p/queued.md")]);
    await started;

    await waitFor(() => expect(opened).toEqual(["/p/queued.md", "/p/late.md"]));
  });
});
