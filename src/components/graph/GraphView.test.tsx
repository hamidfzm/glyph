import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TabsContext, type TabsContextValue } from "@/contexts/TabsContext";
import { useZoomApi } from "@/contexts/ZoomContext";
import { ZoomProvider } from "@/contexts/ZoomProvider";
import { DOUBLE_CLICK_MS } from "@/hooks/useGraphFocus";
import {
  type Camera,
  centerCameraOn,
  FOCUS_SCALE,
  fitCameraToNodes,
  MAX_SCALE,
  worldToScreen,
  zoomCameraAt,
} from "@/lib/graphCanvas";
import { ALPHA_DIMMED } from "@/lib/graphDraw";
import type { GraphLayout, LayoutNode } from "@/lib/graphSimulation";
import { clearGraphView, loadGraphView } from "@/lib/graphViewStore";
import type { VaultSnapshot } from "@/lib/vault";
import { graphOf } from "@/test/fixtures/graph";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { restoreRaf, stubRaf } from "@/test/raf";
import { GraphView } from "./GraphView";

// Shared spies/captures between the test and the hoisted mock factory.
const hoisted = vi.hoisted(() => ({
  reheat: vi.fn(),
  layoutRef: { current: null as GraphLayout | null },
  // Whether the mock layout resumed the stored shape. False means d3 replayed
  // it, which is when a restored camera would frame the wrong coordinates.
  reseeded: { value: true },
}));

// Deterministic stand-in for the d3 layout: node i sits at world (i * 100, 0).
// The layout is memoised per graph (like the real hook) so a node pinned mid
// drag survives the component's re-renders. The view auto-fits, so tests derive
// screen coordinates from the same fit camera the component computes rather
// than assuming a 1:1 mapping.
vi.mock("@/hooks/useGraphSimulation", () => {
  const cache = new WeakMap<VaultSnapshot["graph"], GraphLayout>();
  return {
    useGraphSimulation: (graph: VaultSnapshot["graph"]) => {
      let layout = cache.get(graph);
      if (!layout) {
        const nodes: LayoutNode[] = graph.nodes.map((n, i) => ({ ...n, x: i * 100, y: 0 }));
        const byId = new Map(nodes.map((n) => [n.id, n]));
        const links = graph.edges.map((e) => ({
          source: byId.get(e.source) as LayoutNode,
          target: byId.get(e.target) as LayoutNode,
        }));
        layout = { nodes, links, simulation: null } as unknown as GraphLayout;
        cache.set(graph, layout);
      }
      layout.reseeded = hoisted.reseeded.value;
      hoisted.layoutRef.current = layout;
      return { layout, version: 1, settled: true, reheat: hoisted.reheat };
    },
  };
});

const GRAPH = graphOf(["/v/a.md", "/v/b.md"], [["/v/a.md", "/v/b.md"]]);
const EMPTY_GRAPH = graphOf([]);
const VIEWPORT = { width: 800, height: 600 };

// The fit camera the component lands on for the mock layout, and where each
// node ends up on screen under it.
const FIT_NODES: LayoutNode[] = GRAPH.nodes.map((n, i) => ({
  ...n,
  x: i * 100,
  y: 0,
}));
const FIT = fitCameraToNodes(FIT_NODES, VIEWPORT);
const NODE_A = worldToScreen(FIT, VIEWPORT, 0, 0);
const EMPTY = { x: 40, y: 40 };

// A third, unlinked note, so focusing "a" leaves something outside its
// neighbourhood to dim. The two-file fixture above cannot show dimming: a and b
// are neighbours, so focusing either highlights the whole graph.
const TRIO_GRAPH = graphOf(["/v/a.md", "/v/b.md", "/v/c.md"], [["/v/a.md", "/v/b.md"]]);
const TRIO_FIT_NODES: LayoutNode[] = TRIO_GRAPH.nodes.map((n, i) => ({
  ...n,
  x: i * 100,
  y: 0,
}));
const TRIO_FIT = fitCameraToNodes(TRIO_FIT_NODES, VIEWPORT);
const TRIO_NODE_A = worldToScreen(TRIO_FIT, VIEWPORT, 0, 0);
const TRIO_NODE_C = worldToScreen(TRIO_FIT, VIEWPORT, 200, 0);

function stubContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillText: vi.fn(),
    lineWidth: 0,
    globalAlpha: 1,
    strokeStyle: "",
    fillStyle: "",
    font: "",
    textAlign: "",
    textBaseline: "",
  };
}

let ctx: ReturnType<typeof stubContext>;
/** Every alpha written during the draws since it was last emptied. */
let alphas: number[];

beforeEach(() => {
  hoisted.reheat.mockClear();
  hoisted.layoutRef.current = null;
  hoisted.reseeded.value = true;
  ctx = stubContext();
  alphas = [];
  Object.defineProperty(ctx, "globalAlpha", {
    set: (value: number) => alphas.push(value),
    get: () => 1,
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(
    () => ctx,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {};
  }
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 600,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  restoreRaf();
  restoreMatchMedia();
});

function renderGraph(onOpenFile = vi.fn(), graph = GRAPH) {
  const utils = render(<GraphView graph={graph} onOpenFile={onOpenFile} />);
  return { ...utils, onOpenFile, canvas: screen.getByRole("img", { name: "Workspace graph" }) };
}

// Chromium reports no click count on pointerup (the Pointer Events spec leaves
// `detail` 0 there), so 0 is the realistic default for Windows and Android.
function click(canvas: HTMLElement, point: { x: number; y: number }, clickCount = 0) {
  fireEvent.pointerDown(canvas, { pointerId: 1, clientX: point.x, clientY: point.y });
  fireEvent.pointerUp(canvas, {
    pointerId: 1,
    clientX: point.x,
    clientY: point.y,
    detail: clickCount,
  });
}

/** Scale + x-translation of the most recent world-transform draw call. */
function lastWorldTransform() {
  const calls = ctx.setTransform.mock.calls;
  const last = calls[calls.length - 1];
  return { scale: last[0] as number, tx: last[4] as number };
}

describe("GraphView", () => {
  it("shows an empty state when the workspace has no notes", () => {
    render(<GraphView graph={EMPTY_GRAPH} onOpenFile={vi.fn()} />);
    expect(screen.getByText(/No notes to graph yet/)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("renders the canvas and draws the graph", () => {
    renderGraph();
    expect(ctx.clearRect).toHaveBeenCalled();
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it("hides itself from print output", () => {
    const { container } = renderGraph();
    expect(container.querySelector('[data-print-hide="true"]')).not.toBeNull();
  });

  it("auto-fits the graph on open", () => {
    renderGraph();
    // dpr 1 in the test DOM, so the world transform mirrors the fit camera.
    const { scale, tx } = lastWorldTransform();
    expect(scale).toBeCloseTo(FIT.scale);
    expect(tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("opens the clicked node's file on a second press, with no click count", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A);
    expect(onOpenFile).not.toHaveBeenCalled();
    click(canvas, NODE_A);
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("opens the clicked node's file on a reported double click", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A, 1);
    click(canvas, NODE_A, 2);
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("does not open a file when clicking empty space", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, EMPTY);
    click(canvas, EMPTY);
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("pans on a background drag and stops auto-fitting", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    expect(onOpenFile).not.toHaveBeenCalled();
    // Manual control seeds the fit camera, then pans it +50 in x.
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx + 50);
  });

  it("drags a node: pins it, reheats, and leaves the camera framing put", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x + 60, clientY: NODE_A.y + 20 });
    // Mid-drag the node is pinned and the simulation reheated.
    const draggedNode = hoisted.layoutRef.current?.nodes.find((n) => n.id === "/v/a.md");
    expect(Number.isFinite(draggedNode?.fx)).toBe(true);
    expect(hoisted.reheat).toHaveBeenCalled();
    // A node drag does not pan the camera, so the framing stays at the fit.
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);

    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: NODE_A.x + 60, clientY: NODE_A.y + 20 });
    // Released back into the flow, and never treated as a click.
    expect(draggedNode?.fx).toBeNull();
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("re-frames via the Reset view button after manual control", () => {
    const { canvas } = renderGraph();
    // Reset is disabled while auto-fit is active.
    const reset = screen.getByRole("button", { name: "Reset view" });
    expect(reset).toBeDisabled();

    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 80, clientY: EMPTY.y + 40 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + 80, clientY: EMPTY.y + 40 });
    expect(reset).toBeEnabled();
    expect(lastWorldTransform().tx).not.toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);

    fireEvent.click(reset);
    expect(reset).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("shows the file path tooltip while hovering a node", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(screen.getByText("/v/a.md")).toBeInTheDocument();
    fireEvent.pointerLeave(canvas);
    expect(screen.queryByText("/v/a.md")).not.toBeInTheDocument();
  });

  it("clears the tooltip when hovering empty space", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    expect(screen.queryByText("/v/a.md")).not.toBeInTheDocument();
  });

  it("zooms with the wheel", () => {
    const { canvas } = renderGraph();
    fireEvent.wheel(canvas, { deltaY: -500, clientX: 400, clientY: 300 });
    expect(lastWorldTransform().scale).toBeGreaterThan(FIT.scale);
  });

  it("treats a sub-slop jitter as a click, not a drag", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x + 2, clientY: NODE_A.y + 1 });
    fireEvent.pointerUp(canvas, {
      pointerId: 1,
      clientX: NODE_A.x + 2,
      clientY: NODE_A.y + 1,
      detail: 2,
    });
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
    expect(hoisted.reheat).not.toHaveBeenCalled();
  });

  it("keeps panning on a continued background drag", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 52, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + 52, clientY: EMPTY.y });
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx + 52);
  });

  it("keeps manual control across further gestures", () => {
    const { canvas, onOpenFile } = renderGraph();
    // First pan (+50) takes manual control from auto-fit.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    // Second pan (+30): already manual, so it just pans further.
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: EMPTY.x + 30, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: EMPTY.x + 30, clientY: EMPTY.y });
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx + 80);
    // Clicking the now-shifted node still resolves it (press uses the manual camera).
    fireEvent.pointerDown(canvas, { pointerId: 3, clientX: NODE_A.x + 80, clientY: NODE_A.y });
    fireEvent.pointerUp(canvas, {
      pointerId: 3,
      clientX: NODE_A.x + 80,
      clientY: NODE_A.y,
      detail: 2,
    });
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("ignores a pointer up that has no matching press", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerUp(canvas, { pointerId: 99, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(onOpenFile).not.toHaveBeenCalled();
    // A press from one pointer released under a different id is ignored too.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("falls back to a device pixel ratio of 1 when none is reported", () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true });
    try {
      renderGraph();
      expect(lastWorldTransform().scale).toBeCloseTo(FIT.scale);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", { value: original, configurable: true });
    }
  });

  it("skips drawing when the 2D context is unavailable", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    expect(() => renderGraph()).not.toThrow();
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it("zooms the camera from the Zoom In/Out/Actual-Size commands", () => {
    const ZoomButtons = () => {
      const api = useZoomApi();
      return (
        <>
          <button type="button" onClick={() => api?.actions.zoomIn()}>
            cmd-zoom-in
          </button>
          <button type="button" onClick={() => api?.actions.zoomOut()}>
            cmd-zoom-out
          </button>
          <button type="button" onClick={() => api?.actions.zoomReset()}>
            cmd-zoom-reset
          </button>
        </>
      );
    };
    render(
      <ZoomProvider>
        <GraphView graph={GRAPH} onOpenFile={vi.fn()} />
        <ZoomButtons />
      </ZoomProvider>,
    );
    const reset = screen.getByRole("button", { name: "Reset view" });
    expect(reset).toBeDisabled();

    fireEvent.click(screen.getByText("cmd-zoom-in"));
    // Taking manual control (via the command) enables Reset and enlarges the draw.
    expect(reset).toBeEnabled();
    expect(lastWorldTransform().scale).toBeGreaterThan(FIT.scale);

    fireEvent.click(screen.getByText("cmd-zoom-out"));
    expect(lastWorldTransform().scale).toBeCloseTo(FIT.scale);

    fireEvent.click(screen.getByText("cmd-zoom-reset"));
    expect(reset).toBeDisabled();
    expect(lastWorldTransform().scale).toBeCloseTo(FIT.scale);
  });

  it("treats a missing bounding rect as the origin without crashing", () => {
    const { canvas } = renderGraph();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      undefined as unknown as DOMRect,
    );
    expect(() =>
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y }),
    ).not.toThrow();
  });
});

// The graph tab unmounts whenever another tab is active, so these render inside
// a workspace: the root is the key its view state is stored under.
describe("GraphView view state across a tab switch", () => {
  const ROOT = "/ws";

  afterEach(() => {
    clearGraphView(ROOT);
    clearGraphView("/other");
  });

  // Built here rather than via `renderInWorkspace` so a re-index can rerender
  // the same tree: rerendering without the provider would remount the view.
  function graphIn(root: string, graph = GRAPH) {
    const tabs = { workspace: { root } } as unknown as TabsContextValue;
    return (
      <TabsContext.Provider value={tabs}>
        <GraphView graph={graph} onOpenFile={vi.fn()} />
      </TabsContext.Provider>
    );
  }

  function renderInRoot(root = ROOT) {
    const utils = render(graphIn(root));
    return { ...utils, canvas: screen.getByRole("img", { name: "Workspace graph" }) };
  }

  function pan(canvas: HTMLElement, dx: number) {
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + dx, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + dx, clientY: EMPTY.y });
  }

  it("comes back to the same camera, with no re-fit in between", () => {
    const first = renderInRoot();
    pan(first.canvas, 60);
    const panned = lastWorldTransform();
    expect(panned.tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx + 60);
    first.unmount();

    renderInRoot();
    expect(lastWorldTransform().tx).toBeCloseTo(panned.tx);
    expect(screen.getByRole("button", { name: "Reset view" })).toBeEnabled();
  });

  it("comes back still auto-fitting when the camera was never touched", () => {
    const first = renderInRoot();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    first.unmount();

    renderInRoot();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("stays auto-fit across a switch that follows a reset", () => {
    const first = renderInRoot();
    pan(first.canvas, 60);
    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(loadGraphView(ROOT)?.autoFit).toBe(true);
    first.unmount();

    renderInRoot();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("re-fits instead of restoring the camera when the layout replayed", () => {
    const first = renderInRoot();
    pan(first.canvas, 60);
    first.unmount();

    // Too few nodes came back seeded (a large re-index while the tab was in the
    // background), so d3 replayed the layout around the origin. Restoring the
    // manual camera would frame empty space.
    hoisted.reseeded.value = false;
    renderInRoot();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("starts fresh once the graph tab's state is cleared", () => {
    const first = renderInRoot();
    pan(first.canvas, 60);
    first.unmount();

    // What closing the graph tab does.
    clearGraphView(ROOT);
    renderInRoot();
    expect(screen.getByRole("button", { name: "Reset view" })).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });

  it("keeps the camera through a re-index", () => {
    const { canvas, rerender } = renderInRoot();
    pan(canvas, 60);
    const panned = lastWorldTransform();

    // The watcher re-indexes the workspace, so the graph and layout are rebuilt.
    rerender(graphIn(ROOT, TRIO_GRAPH));
    expect(lastWorldTransform().tx).toBeCloseTo(panned.tx);
  });

  it("keeps one workspace's camera out of another's", () => {
    const first = renderInRoot();
    pan(first.canvas, 60);
    first.unmount();

    renderInRoot("/other");
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
  });
});

describe("GraphView node focus", () => {
  it("focuses a node on a single click instead of opening it", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A, 1);
    expect(onOpenFile).not.toHaveBeenCalled();
    // Focusing takes manual control, so auto-fit stops re-framing over the node.
    expect(screen.getByRole("button", { name: "Reset view" })).toBeEnabled();
  });

  it("centres the camera on the focused node, instantly under reduced motion", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { canvas } = renderGraph();
    click(canvas, NODE_A, 1);
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    const target = centerCameraOn(0, 0, FOCUS_SCALE);
    expect(lastWorldTransform().scale).toBeCloseTo(target.scale);
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + target.dx);
  });

  it("animates the focus camera over frames when motion is allowed", () => {
    stubMatchMedia(false);
    vi.useFakeTimers();
    const raf = stubRaf();
    const { canvas } = renderGraph();
    click(canvas, NODE_A, 1);
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    // The tween is scheduled but no frame has run, so the framing has not moved.
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + FIT.dx);
    act(() => {
      raf.settle();
    });
    const target = centerCameraOn(0, 0, FOCUS_SCALE);
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + target.dx);
  });

  it("keeps the focus camera within the maximum zoom", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { canvas } = renderGraph();
    // Wheel all the way in; the camera clamps at MAX_SCALE well before the last step.
    let zoomed: Camera = FIT;
    for (let i = 0; i < 4; i += 1) {
      fireEvent.wheel(canvas, { deltaY: -800, clientX: 400, clientY: 300 });
      zoomed = zoomCameraAt(zoomed, 400, 300, Math.exp(1.2), VIEWPORT);
    }
    expect(zoomed.scale).toBe(MAX_SCALE);

    click(canvas, worldToScreen(zoomed, VIEWPORT, 0, 0), 1);
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    expect(lastWorldTransform().scale).toBeCloseTo(MAX_SCALE);
  });

  it("opens on a double click without ever animating a focus", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A, 1);
    click(canvas, NODE_A, 2);
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");

    const framing = lastWorldTransform();
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(lastWorldTransform()).toEqual(framing);
  });

  it("focuses from a camera restored across a tab switch, not from the fit", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    // Pan, leave the tab, come back: the camera is restored and manual.
    const tabs = { workspace: { root: "/ws" } } as unknown as TabsContextValue;
    const graph = (
      <TabsContext.Provider value={tabs}>
        <GraphView graph={GRAPH} onOpenFile={vi.fn()} />
      </TabsContext.Provider>
    );
    const first = render(graph);
    const canvas = screen.getByRole("img", { name: "Workspace graph" });
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: EMPTY.x + 60, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x + 60, clientY: EMPTY.y });
    first.unmount();
    render(graph);

    // The node sits 60px right of where it was, because the camera came back panned.
    const restored = screen.getByRole("img", { name: "Workspace graph" });
    click(restored, { x: NODE_A.x + 60, y: NODE_A.y });
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS);
    });
    // The click only lands on the node if the camera really came back panned,
    // and the zoom only reaches FOCUS_SCALE if the focus ran.
    const target = centerCameraOn(0, 0, FOCUS_SCALE);
    expect(lastWorldTransform().scale).toBeCloseTo(target.scale);
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + target.dx);
    clearGraphView("/ws");
  });

  it("keeps the focused neighbourhood highlighted after the cursor moves away", () => {
    const { canvas } = renderGraph(vi.fn(), TRIO_GRAPH);
    click(canvas, TRIO_NODE_A, 1);
    // Hovering the unlinked note previews its own neighbourhood on top.
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: TRIO_NODE_C.x, clientY: TRIO_NODE_C.y });
    alphas.length = 0;
    fireEvent.pointerLeave(canvas);
    expect(alphas).toContain(ALPHA_DIMMED);
  });

  it("clears the focus when the background is clicked", () => {
    const { canvas } = renderGraph(vi.fn(), TRIO_GRAPH);
    click(canvas, TRIO_NODE_A, 1);
    expect(alphas).toContain(ALPHA_DIMMED);

    alphas.length = 0;
    click(canvas, EMPTY, 1);
    expect(alphas).not.toContain(ALPHA_DIMMED);
  });

  it("never treats a cancelled gesture as a click", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A);

    // A cancel on the focused node would otherwise read as the opening press.
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerCancel(canvas, { pointerId: 2, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("ignores a cancel that has no matching press", () => {
    const { canvas, onOpenFile } = renderGraph();
    click(canvas, NODE_A);
    // A cancel for a pointer that never pressed must not touch the focus state.
    fireEvent.pointerCancel(canvas, { pointerId: 99, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(onOpenFile).not.toHaveBeenCalled();
    expect(hoisted.reheat).not.toHaveBeenCalled();
  });

  it("releases a node whose drag is cancelled", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: NODE_A.x + 60, clientY: NODE_A.y });
    const dragged = hoisted.layoutRef.current?.nodes.find((n) => n.id === "/v/a.md");
    expect(Number.isFinite(dragged?.fx)).toBe(true);

    fireEvent.pointerCancel(canvas, { pointerId: 1, clientX: NODE_A.x + 60, clientY: NODE_A.y });
    expect(dragged?.fx).toBeNull();
  });

  it("stops a running focus move when the next gesture takes the camera", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { canvas } = renderGraph();
    click(canvas, NODE_A);

    // Panning inside the window must win: the deferred move never lands.
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: EMPTY.x + 50, clientY: EMPTY.y });
    const panned = lastWorldTransform();
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(lastWorldTransform()).toEqual(panned);
  });

  it("stops a running focus move when the wheel takes the camera", () => {
    stubMatchMedia(true);
    vi.useFakeTimers();
    const { canvas } = renderGraph();
    click(canvas, NODE_A);

    fireEvent.wheel(canvas, { deltaY: -200, clientX: 400, clientY: 300 });
    const zoomed = lastWorldTransform();
    act(() => {
      vi.advanceTimersByTime(DOUBLE_CLICK_MS * 4);
    });
    expect(lastWorldTransform()).toEqual(zoomed);
  });

  it("clears the focus and returns to auto-fit on Reset view", () => {
    const { canvas } = renderGraph(vi.fn(), TRIO_GRAPH);
    click(canvas, TRIO_NODE_A, 1);
    const reset = screen.getByRole("button", { name: "Reset view" });
    expect(reset).toBeEnabled();
    expect(alphas).toContain(ALPHA_DIMMED);

    alphas.length = 0;
    fireEvent.click(reset);
    expect(alphas).not.toContain(ALPHA_DIMMED);
    expect(reset).toBeDisabled();
    expect(lastWorldTransform().tx).toBeCloseTo(VIEWPORT.width / 2 + TRIO_FIT.dx);
  });
});
