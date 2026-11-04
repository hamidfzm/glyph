import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { deferred } from "@/test/deferred";
import { useWriteQueue } from "./useWriteQueue";

describe("useWriteQueue", () => {
  it("settles once every write asked for so far has finished, a failed one included", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const gate = deferred();
    const held = result.current.enqueueWrite("/p/a.md", () => gate.promise);
    const failed = result.current.enqueueWrite("/p/b.md", () =>
      Promise.reject(new Error("disk full")),
    );
    await expect(failed).rejects.toThrow("disk full");

    let settled = false;
    const settling = result.current.writesSettled().then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    gate.resolve();
    await held;
    await settling;
    expect(settled).toBe(true);
  });

  it("holds a write to the same path until the one before it has finished", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const gate = deferred();
    const second = vi.fn(async () => "second");

    const first = result.current.enqueueWrite("/p/a.md", () => gate.promise.then(() => "first"));
    const queued = result.current.enqueueWrite("/p/a.md", second);
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

    const held = result.current.enqueueWrite("/p/a.md", () => gate.promise);
    await result.current.enqueueWrite("/p/b.md", other);
    expect(other).toHaveBeenCalledOnce();

    gate.resolve();
    await held;
  });

  it("reports a failed write to its caller and still runs the next one", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const next = vi.fn(async () => {});

    const failing = result.current.enqueueWrite("/p/a.md", () =>
      Promise.reject(new Error("disk full")),
    );
    const queued = result.current.enqueueWrite("/p/a.md", next);

    await expect(failing).rejects.toThrow("disk full");
    await queued;
    expect(next).toHaveBeenCalledOnce();
  });
});

describe("useWriteQueue relocations", () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("runs a relocation once the writes inside the moved path have finished", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const inside = deferred();
    const outside = deferred();
    const relocate = vi.fn(async () => "moved");

    const write = result.current.enqueueWrite("/p/dir/a.md", () => inside.promise);
    result.current.enqueueWrite("/p/other.md", () => outside.promise);
    const relocating = result.current.enqueueRelocation("/p/dir", relocate);
    await flush();
    const startedEarly = relocate.mock.calls.length > 0;

    inside.resolve();
    await write;
    expect(await relocating).toBe("moved");
    expect(startedEarly).toBe(false);
    outside.resolve();
  });

  it("holds a write of a moved path asked for meanwhile, one never written before included", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const gate = deferred();
    const order: string[] = [];

    const relocating = result.current.enqueueRelocation("/p/dir", async () => {
      await gate.promise;
      order.push("move");
    });
    const writes = ["/p/dir/a.md", "/p/dir/sub/b.md"].map((path) =>
      result.current.enqueueWrite(path, async () => {
        order.push(path);
      }),
    );
    await result.current.enqueueWrite("/p/dir.md", async () => {
      order.push("/p/dir.md");
    });

    gate.resolve();
    await Promise.all([relocating, ...writes]);
    expect(order).toEqual(["/p/dir.md", "move", "/p/dir/a.md", "/p/dir/sub/b.md"]);
  });

  it("lets the writes it held run when a relocation fails", async () => {
    const { result } = renderHook(() => useWriteQueue());
    const next = vi.fn(async () => {});

    const relocating = result.current.enqueueRelocation("/p/a.md", () =>
      Promise.reject(new Error("refused")),
    );
    const queued = result.current.enqueueWrite("/p/a.md", next);

    await expect(relocating).rejects.toThrow("refused");
    await queued;
    expect(next).toHaveBeenCalledOnce();
  });
});
