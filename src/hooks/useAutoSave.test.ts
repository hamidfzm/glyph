import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoSave } from "./useAutoSave";

describe("useAutoSave", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(invoke).mockReset();
    vi.mocked(invoke).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not save when dirty is false", async () => {
    const onSaved = vi.fn();
    renderHook(() => useAutoSave({ path: "/p/doc.md", content: "hello", dirty: false, onSaved }));

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });

    expect(invoke).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("does not save when path is undefined", async () => {
    renderHook(() =>
      useAutoSave({ path: undefined, content: "hello", dirty: true, onSaved: vi.fn() }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("does not save when content is null", async () => {
    renderHook(() =>
      useAutoSave({ path: "/p/doc.md", content: null, dirty: true, onSaved: vi.fn() }),
    );

    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("debounces writes by 2000ms and calls onSaved after success", async () => {
    const onSaved = vi.fn();
    renderHook(() => useAutoSave({ path: "/p/doc.md", content: "v1", dirty: true, onSaved }));

    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(500);
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledWith("write_file", { path: "/p/doc.md", content: "v1" });
    expect(onSaved).toHaveBeenCalledWith("v1");
  });

  it("logs and swallows errors from write_file", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const onSaved = vi.fn();

    renderHook(() => useAutoSave({ path: "/p/doc.md", content: "v1", dirty: true, onSaved }));

    await act(async () => {
      vi.advanceTimersByTime(2000);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(errSpy).toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it("restarts the timer when content changes mid-debounce", async () => {
    const onSaved = vi.fn();
    const { rerender } = renderHook(
      ({ content }: { content: string }) =>
        useAutoSave({ path: "/p/doc.md", content, dirty: true, onSaved }),
      { initialProps: { content: "v1" } },
    );

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    rerender({ content: "v2" });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(invoke).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await Promise.resolve();
    });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith("write_file", { path: "/p/doc.md", content: "v2" });
  });
});
