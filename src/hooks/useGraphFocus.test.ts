import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, type Mock, vi } from "vitest";
import { type Camera, centerCameraOn, DEFAULT_CAMERA, FOCUS_SCALE } from "@/lib/graphCanvas";
import type { GraphLayout, LayoutNode } from "@/lib/graphSimulation";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { DOUBLE_CLICK_MS, useGraphFocus } from "./useGraphFocus";

function node(id: string, x?: number, y?: number): LayoutNode {
  return { id, label: id, degree: 0, orphan: true, x, y };
}

function layoutOf(...nodes: LayoutNode[]): GraphLayout {
  return { nodes, links: [], simulation: null } as unknown as GraphLayout;
}

// Reduced motion makes the spring snap in one step, so the camera write lands
// with the timer instead of over animation frames.
function setup(layout: GraphLayout) {
  stubMatchMedia(true);
  const set = vi.fn();
  const takeManualControl = vi.fn();
  const camera = { camera: DEFAULT_CAMERA, pan: vi.fn(), zoomAt: vi.fn(), set };
  const view = renderHook(
    ({ live }: { live: GraphLayout }) =>
      useGraphFocus({ camera, cameraNow: () => DEFAULT_CAMERA, takeManualControl, layout: live }),
    { initialProps: { live: layout } },
  );
  return { view, set, takeManualControl };
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
    const a = node("a");
    const { view, set, takeManualControl } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
    expect(view.result.current.focusedId).toBe("a");
    expect(takeManualControl).toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expectLastCamera(set, centerCameraOn(0, 0, FOCUS_SCALE));
  });

  it("holds the camera until the double-click window has passed", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
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
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
    // d3 mutates positions in place while the layout keeps cooling.
    a.x = 180;
    a.y = -60;
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expectLastCamera(set, centerCameraOn(180, -60, FOCUS_SCALE));
  });

  it("follows a re-index that replaces the node objects", () => {
    vi.useFakeTimers();
    const pressed = node("a", 40, 25);
    const { view, set } = setup(layoutOf(pressed));

    act(() => view.result.current.focusNode(pressed));
    // A watcher-driven re-index builds a fresh layout; the pressed object is
    // abandoned at its old coordinates.
    act(() => view.rerender({ live: layoutOf(node("a", -15, 90)) }));
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expectLastCamera(set, centerCameraOn(-15, 90, FOCUS_SCALE));
  });

  it("drops a focus whose note has left the graph", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a, node("b", 100, 0)));

    act(() => view.result.current.focusNode(a));
    // The note is deleted or renamed, so it is gone from the next index.
    act(() => view.rerender({ live: layoutOf(node("b", 100, 0)) }));
    expect(view.result.current.focusedId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("cancels a pending camera move when the focus is cleared", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
    act(() => view.result.current.clearFocus());
    expect(view.result.current.focusedId).toBeNull();

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("cancels the camera move but keeps the highlight", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
    act(() => view.result.current.cancelMove());
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(set).not.toHaveBeenCalled();
    expect(view.result.current.focusedId).toBe("a");
  });

  it("cancels a pending camera move when the view unmounts", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const { view, set } = setup(layoutOf(a));

    act(() => view.result.current.focusNode(a));
    view.unmount();
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(set).not.toHaveBeenCalled();
  });

  it("retargets to the node of a second focus without moving to the first", () => {
    vi.useFakeTimers();
    const a = node("a", 40, 25);
    const b = node("b", -80, 10);
    const { view, set } = setup(layoutOf(a, b));

    act(() => view.result.current.focusNode(a));
    act(() => view.result.current.focusNode(b));
    expect(view.result.current.focusedId).toBe("b");

    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expect(set).toHaveBeenCalledTimes(1);
    expectLastCamera(set, centerCameraOn(-80, 10, FOCUS_SCALE));
  });
});
