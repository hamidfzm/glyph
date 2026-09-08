import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { type Camera, centerCameraOn, DEFAULT_CAMERA, FOCUS_SCALE } from "@/lib/graphCanvas";
import type { LayoutNode } from "@/lib/graphSimulation";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { DOUBLE_CLICK_MS, useGraphFocus } from "./useGraphFocus";

// Reduced motion makes the spring snap in one step, so the camera write lands
// synchronously with the timer instead of over animation frames.
function setup() {
  stubMatchMedia(true);
  const set = vi.fn();
  const takeManualControl = vi.fn();
  const camera = { camera: DEFAULT_CAMERA, pan: vi.fn(), zoomAt: vi.fn(), set };
  const view = renderHook(() =>
    useGraphFocus({ camera, cameraNow: () => DEFAULT_CAMERA, takeManualControl }),
  );
  return { view, set, takeManualControl };
}

function node(id: string, x?: number, y?: number): LayoutNode {
  return { id, label: id, degree: 0, orphan: true, x, y };
}

// The tween arrives at its target by arithmetic, so a target of -0 lands as 0.
// `toHaveBeenCalledWith` tells those apart; comparing the fields does not.
function expectLastCamera(set: Mock, expected: Camera) {
  const actual = set.mock.calls.at(-1)?.[0] as Camera;
  expect(actual.scale).toBeCloseTo(expected.scale);
  expect(actual.dx).toBeCloseTo(expected.dx);
  expect(actual.dy).toBeCloseTo(expected.dy);
}

afterEach(() => {
  vi.useRealTimers();
  restoreMatchMedia();
});

describe("useGraphFocus", () => {
  it("frames a node that carries no coordinates at the origin", () => {
    vi.useFakeTimers();
    const { view, set, takeManualControl } = setup();

    act(() => view.result.current.focusNode(node("a")));
    expect(view.result.current.focusedId).toBe("a");
    expect(takeManualControl).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expectLastCamera(set, centerCameraOn(0, 0, FOCUS_SCALE));
  });

  it("holds the camera until the double-click window has passed", () => {
    vi.useFakeTimers();
    const { view, set } = setup();

    act(() => view.result.current.focusNode(node("a", 40, 25)));
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS - 1);
    });
    expect(set).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expectLastCamera(set, centerCameraOn(40, 25, FOCUS_SCALE));
  });

  it("frames where a still-settling node ended up, not where it was pressed", () => {
    vi.useFakeTimers();
    const { view, set } = setup();
    const settling = node("a", 40, 25);

    act(() => view.result.current.focusNode(settling));
    // d3 mutates positions in place while the layout keeps cooling.
    settling.x = 180;
    settling.y = -60;
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expectLastCamera(set, centerCameraOn(180, -60, FOCUS_SCALE));
  });

  it("cancels a pending camera move when the focus is cleared", () => {
    vi.useFakeTimers();
    const { view, set } = setup();

    act(() => view.result.current.focusNode(node("a", 40, 25)));
    act(() => view.result.current.clearFocus());
    expect(view.result.current.focusedId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("cancels a pending camera move when the view unmounts", () => {
    vi.useFakeTimers();
    const { view, set } = setup();

    act(() => view.result.current.focusNode(node("a", 40, 25)));
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("retargets to the node of a second focus without moving to the first", () => {
    vi.useFakeTimers();
    const { view, set } = setup();

    act(() => view.result.current.focusNode(node("a", 40, 25)));
    act(() => view.result.current.focusNode(node("b", -80, 10)));
    expect(view.result.current.focusedId).toBe("b");

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expect(set).toHaveBeenCalledTimes(1);
    expectLastCamera(set, centerCameraOn(-80, 10, FOCUS_SCALE));
  });
});
