import { listen } from "@tauri-apps/api/event";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useFileWatcher } from "./useFileWatcher";

describe("useFileWatcher", () => {
  let listener: (() => void) | null = null;
  let unlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listener = null;
    unlisten = vi.fn();
    vi.useFakeTimers();
    vi.mocked(listen).mockImplementation(((_event: string, cb: (e: unknown) => void) => {
      listener = () => cb({ payload: undefined });
      return Promise.resolve(unlisten);
    }) as unknown as typeof listen);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(listen).mockReset();
  });

  it("subscribes to file-changed and debounces the callback by 300ms", async () => {
    const handler = vi.fn();
    renderHook(() => useFileWatcher(handler));
    await Promise.resolve();

    expect(listen).toHaveBeenCalledWith("file-changed", expect.any(Function));
    expect(listener).not.toBeNull();

    listener?.();
    listener?.();
    listener?.();
    expect(handler).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("uses the latest callback reference when the event fires", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }: { cb: () => void }) => useFileWatcher(cb), {
      initialProps: { cb: first },
    });
    await Promise.resolve();

    rerender({ cb: second });
    listener?.();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("clears the timer and unsubscribes on unmount", async () => {
    const handler = vi.fn();
    const { unmount } = renderHook(() => useFileWatcher(handler));
    await Promise.resolve();

    listener?.();
    unmount();
    await Promise.resolve();

    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(handler).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalled();
  });
});
