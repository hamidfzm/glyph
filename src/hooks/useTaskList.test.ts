import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useTaskList } from "./useTaskList";

describe("useTaskList", () => {
  it("forwards the line argument to toggleTask using the active tab id", () => {
    const toggleTask = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useTaskList({ activeTabId: "tab-1", toggleTask }));
    result.current.handleToggle(7);
    expect(toggleTask).toHaveBeenCalledWith("tab-1", 7);
  });

  it("is a no-op when no tab is active", () => {
    const toggleTask = vi.fn();
    const { result } = renderHook(() => useTaskList({ activeTabId: null, toggleTask }));
    result.current.handleToggle(3);
    expect(toggleTask).not.toHaveBeenCalled();
  });

  it("returns a stable reference while inputs are unchanged", () => {
    const toggleTask = vi.fn();
    const { result, rerender } = renderHook(
      (props: { activeTabId: string | null }) =>
        useTaskList({ activeTabId: props.activeTabId, toggleTask }),
      { initialProps: { activeTabId: "tab-1" } },
    );
    const first = result.current.handleToggle;
    rerender({ activeTabId: "tab-1" });
    expect(result.current.handleToggle).toBe(first);
    rerender({ activeTabId: "tab-2" });
    expect(result.current.handleToggle).not.toBe(first);
  });
});
