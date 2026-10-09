import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSelfSaveTracker } from "./useSelfSaveTracker";

describe("useSelfSaveTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts the app's writes to each path separately", () => {
    const { result } = renderHook(() => useSelfSaveTracker());
    expect(result.current.selfSaveCount("/p/a.md")).toBe(0);

    result.current.markSelfSave("/p/a.md");
    result.current.markSelfSave("/p/a.md");
    result.current.markSelfSave("/p/b.md");

    expect(result.current.selfSaveCount("/p/a.md")).toBe(2);
    expect(result.current.selfSaveCount("/p/b.md")).toBe(1);
  });

  it("treats a path as recently saved only within the grace window of its last write", () => {
    const { result } = renderHook(() => useSelfSaveTracker());
    expect(result.current.isRecentSelfSave("/p/a.md")).toBe(false);

    result.current.markSelfSave("/p/a.md");
    vi.advanceTimersByTime(1499);
    expect(result.current.isRecentSelfSave("/p/a.md")).toBe(true);
    expect(result.current.isRecentSelfSave("/p/b.md")).toBe(false);

    vi.advanceTimersByTime(1);
    expect(result.current.isRecentSelfSave("/p/a.md")).toBe(false);
  });
});
