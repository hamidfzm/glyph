import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceNotice } from "./useWorkspaceNotice";

describe("useWorkspaceNotice", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a notice then auto-dismisses after the timeout", () => {
    const { result } = renderHook(() => useWorkspaceNotice());
    expect(result.current.notice).toBeNull();

    act(() => result.current.show("nope"));
    expect(result.current.notice).toBe("nope");

    act(() => vi.advanceTimersByTime(6000));
    expect(result.current.notice).toBeNull();
  });

  it("keeps a persistent notice up past the auto-dismiss timeout", () => {
    const { result } = renderHook(() => useWorkspaceNotice());

    act(() => result.current.show("heads up", { persistent: true }));
    expect(result.current.notice).toBe("heads up");

    // Well past the transient timeout: a persistent notice stays until dismissed.
    act(() => vi.advanceTimersByTime(60000));
    expect(result.current.notice).toBe("heads up");

    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  it("dismiss clears the notice immediately", () => {
    const { result } = renderHook(() => useWorkspaceNotice());
    act(() => result.current.show("nope"));
    act(() => result.current.dismiss());
    expect(result.current.notice).toBeNull();
  });

  it("a new show replaces the message and resets the timer", () => {
    const { result } = renderHook(() => useWorkspaceNotice());
    act(() => result.current.show("first"));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.show("second"));
    expect(result.current.notice).toBe("second");

    // 3s after the second show: still up (timer was reset).
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.notice).toBe("second");

    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.notice).toBeNull();
  });
});
