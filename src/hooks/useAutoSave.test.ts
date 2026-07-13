import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type SavableDocument, useAutoSave } from "./useAutoSave";

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves a dirty document after the debounce", async () => {
    const save = vi.fn();
    renderHook(() => useAutoSave({ documents: [{ id: "a", revision: 1 }], save }));

    await act(async () => {
      vi.advanceTimersByTime(1999);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("gives every dirty document its own timer (switching tabs saves both)", async () => {
    const save = vi.fn();
    renderHook(() =>
      useAutoSave({
        documents: [
          { id: "a", revision: 1 },
          { id: "b", revision: 1 },
        ],
        save,
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenCalledWith("a");
    expect(save).toHaveBeenCalledWith("b");
  });

  it("keeps a document's pending save when another document becomes dirty", async () => {
    const save = vi.fn();
    // 'a' is dirty and waiting; then 'b' becomes dirty too (a tab switch + edit).
    // 'a's timer must not be cancelled by the second document appearing.
    const { rerender } = renderHook(
      ({ docs }: { docs: SavableDocument[] }) => useAutoSave({ documents: docs, save }),
      { initialProps: { docs: [{ id: "a", revision: 1 }] } },
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    rerender({
      docs: [
        { id: "a", revision: 1 },
        { id: "b", revision: 1 },
      ],
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // 'a' reached its 2000ms mark uninterrupted.
    expect(save).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("restarts the debounce when a document's revision advances", async () => {
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ rev }: { rev: number }) => useAutoSave({ documents: [{ id: "a", revision: rev }], save }),
      { initialProps: { rev: 1 } },
    );

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    rerender({ rev: 2 });
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(save).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    expect(save).toHaveBeenCalledExactlyOnceWith("a");
  });

  it("fires only once per revision across re-renders", async () => {
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ docs }: { docs: SavableDocument[] }) => useAutoSave({ documents: docs, save }),
      { initialProps: { docs: [{ id: "a", revision: 1 }] } },
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);

    // Same revision still dirty (e.g. a failed save): must not re-fire.
    rerender({ docs: [{ id: "a", revision: 1 }] });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("cancels a document's timer when it stops being dirty before the debounce", async () => {
    const save = vi.fn();
    const { rerender } = renderHook(
      ({ docs }: { docs: SavableDocument[] }) => useAutoSave({ documents: docs, save }),
      { initialProps: { docs: [{ id: "a", revision: 1 }] } },
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    rerender({ docs: [] });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(save).not.toHaveBeenCalled();
  });
});
