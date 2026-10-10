import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/deferred";
import { useWriteQueue } from "./useWriteQueue";

describe("useWriteQueue", () => {
  it("holds a write to the same path until the one before it has finished", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const gate = deferred();
    const second = vi.fn(async () => "second");

    const first = result.current("/p/a.md", () => gate.promise.then(() => "first"));
    const queued = result.current("/p/a.md", second);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startedEarly = second.mock.calls.length > 0;

    gate.resolve();
    expect(await first).toBe("first");
    expect(await queued).toBe("second");
    expect(startedEarly).toBe(false);
  });

  it("lets writes to different paths run at the same time", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const gate = deferred();
    const other = vi.fn(async () => {});

    const held = result.current("/p/a.md", () => gate.promise);
    await result.current("/p/b.md", other);
    expect(other).toHaveBeenCalledOnce();

    gate.resolve();
    await held;
  });

  it("reports a failed write to its caller and still runs the next one", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const next = vi.fn(async () => {});

    const failing = result.current("/p/a.md", () => Promise.reject(new Error("disk full")));
    const queued = result.current("/p/a.md", next);

    await expect(failing).rejects.toThrow("disk full");
    await queued;
    expect(next).toHaveBeenCalledOnce();
  });
});
