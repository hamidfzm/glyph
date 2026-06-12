import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Rect } from "@/lib/canvas/geometry";
import { MAX_ZOOM } from "@/lib/canvas/viewport";
import { useCanvasViewport } from "./useCanvasViewport";

/**
 * Build a WheelEvent with a modifier flag set. happy-dom's WheelEvent
 * constructor ignores `ctrlKey`/`metaKey` from the init dict, so we pin them on
 * the instance directly before dispatch.
 */
function wheelEvent(init: WheelEventInit, modifier?: "ctrlKey" | "metaKey"): WheelEvent {
  const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, ...init });
  if (modifier) Object.defineProperty(event, modifier, { value: true });
  return event;
}

/**
 * Wrapper that binds the hook's stageRef to a real element (so the native wheel
 * listener attaches) and renders the live viewport into the DOM for assertions.
 */
function Harness() {
  const vp = useCanvasViewport();
  return (
    <div data-testid="stage" ref={vp.stageRef}>
      <span data-testid="zoom">{vp.viewport.zoom}</span>
      <span data-testid="pos">
        {vp.viewport.x},{vp.viewport.y}
      </span>
    </div>
  );
}

describe("useCanvasViewport", () => {
  it("starts at the neutral viewport", () => {
    const { result } = renderHook(() => useCanvasViewport());
    expect(result.current.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("panBy shifts x/y by the delta", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.panBy(15, -25));
    expect(result.current.viewport).toMatchObject({ x: 15, y: -25, zoom: 1 });
    act(() => result.current.panBy(5, 10));
    expect(result.current.viewport).toMatchObject({ x: 20, y: -15 });
  });

  it("zoomBy multiplies the zoom factor", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.zoomBy(2));
    expect(result.current.viewport.zoom).toBe(2);
    act(() => result.current.zoomBy(1.5));
    expect(result.current.viewport.zoom).toBe(3);
  });

  it("zoomBy clamps to MAX_ZOOM", () => {
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.zoomBy(100));
    expect(result.current.viewport.zoom).toBe(MAX_ZOOM);
  });

  it("zoomBy pivots on the origin when no stage is bound", () => {
    // With no stage element, getBoundingClientRect() is undefined, so the pivot
    // falls back to (0,0): zoom changes but the origin stays put.
    const { result } = renderHook(() => useCanvasViewport());
    act(() => result.current.zoomBy(2));
    expect(result.current.viewport).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it("zoomBy pivots on the stage centre when a stage is bound", () => {
    // Stage bound: getBoundingClientRect() returns an object (zeroed in
    // happy-dom), so the rect-present branch runs and the pivot is (0,0) too.
    let captured!: ReturnType<typeof useCanvasViewport>;
    function ZoomHarness() {
      captured = useCanvasViewport();
      return <div ref={captured.stageRef} />;
    }
    render(<ZoomHarness />);
    act(() => captured.zoomBy(2));
    expect(captured.viewport).toEqual({ x: 0, y: 0, zoom: 2 });
  });

  it("toStagePoint returns client coords unchanged when the rect is zero/absent", () => {
    const { result } = renderHook(() => useCanvasViewport());
    // No stage element bound: falls back to the (0,0) origin.
    expect(result.current.toStagePoint(120, 80)).toEqual({ x: 120, y: 80 });
  });

  it("fitTo stays neutral when the stage has zero size", () => {
    const { result } = renderHook(() => useCanvasViewport());
    // No stage element: early-returns, viewport unchanged.
    act(() => result.current.fitTo(null));
    expect(result.current.viewport).toEqual({ x: 0, y: 0, zoom: 1 });

    const rect: Rect = { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    act(() => result.current.fitTo(rect));
    expect(result.current.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("fitTo on a bound stage with zero clientWidth/Height yields a neutral viewport", () => {
    let captured!: ReturnType<typeof useCanvasViewport>;
    function FitHarness() {
      captured = useCanvasViewport();
      return <div data-testid="stage" ref={captured.stageRef} />;
    }
    render(<FitHarness />);

    const rect: Rect = { minX: 0, minY: 0, maxX: 200, maxY: 200 };
    expect(() => act(() => captured.fitTo(rect))).not.toThrow();
    expect(captured.viewport).toEqual({ x: 0, y: 0, zoom: 1 });

    act(() => captured.fitTo(null));
    expect(captured.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it("ctrl+wheel zooms via the native non-passive listener", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    const zoom = () => Number(getByTestId("zoom").textContent);

    expect(zoom()).toBe(1);
    // deltaY < 0 with ctrlKey -> zoom in (factor = exp(-deltaY * intensity) > 1).
    act(() => {
      fireEvent(stage, wheelEvent({ deltaY: -100, clientX: 0, clientY: 0 }, "ctrlKey"));
    });
    expect(zoom()).toBeGreaterThan(1);
  });

  it("meta+wheel also zooms", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    const zoom = () => Number(getByTestId("zoom").textContent);

    act(() => {
      fireEvent(stage, wheelEvent({ deltaY: -50, clientX: 0, clientY: 0 }, "metaKey"));
    });
    expect(zoom()).toBeGreaterThan(1);
  });

  it("plain wheel pans (inverted delta)", () => {
    const { getByTestId } = render(<Harness />);
    const stage = getByTestId("stage");
    const pos = () => getByTestId("pos").textContent;

    expect(pos()).toBe("0,0");
    act(() => {
      fireEvent.wheel(stage, { deltaX: 20, deltaY: 10, clientX: 0, clientY: 0 });
    });
    // Handler pans by (-deltaX, -deltaY).
    expect(pos()).toBe("-20,-10");
  });

  it("detaches the wheel listener on unmount without throwing", () => {
    const { getByTestId, unmount } = render(<Harness />);
    const stage = getByTestId("stage");
    expect(() => unmount()).not.toThrow();
    // After unmount the listener is removed; dispatching must not blow up.
    expect(() =>
      fireEvent(stage, wheelEvent({ deltaY: -10, clientX: 0, clientY: 0 }, "ctrlKey")),
    ).not.toThrow();
  });

  describe("persistence", () => {
    it("restores a persisted viewport and reports it as restored", () => {
      const first = renderHook(() => useCanvasViewport("persist:a"));
      expect(first.result.current.restored).toBe(false);
      act(() => {
        first.result.current.panBy(120, -40);
      });
      first.unmount();

      const second = renderHook(() => useCanvasViewport("persist:a"));
      expect(second.result.current.restored).toBe(true);
      expect(second.result.current.viewport).toMatchObject({ x: 120, y: -40, zoom: 1 });
    });

    it("keeps independent viewpoints per key", () => {
      const a = renderHook(() => useCanvasViewport("persist:b"));
      act(() => {
        a.result.current.panBy(10, 10);
      });
      a.unmount();

      const c = renderHook(() => useCanvasViewport("persist:c"));
      expect(c.result.current.restored).toBe(false);
      expect(c.result.current.viewport).toMatchObject({ x: 0, y: 0, zoom: 1 });
    });

    it("does not persist anything without a key", () => {
      const anon = renderHook(() => useCanvasViewport());
      act(() => {
        anon.result.current.panBy(5, 5);
      });
      anon.unmount();
      const again = renderHook(() => useCanvasViewport());
      expect(again.result.current.viewport).toMatchObject({ x: 0, y: 0, zoom: 1 });
    });
  });
});
