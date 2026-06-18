import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WikilinkRef } from "@/lib/backlinks";
import { buildWorkspaceGraph, type WorkspaceGraph } from "@/lib/graph";
import { fitCameraToNodes, worldToScreen } from "@/lib/graphCanvas";
import type { GraphLayout, LayoutNode } from "@/lib/graphSimulation";
import { GraphView } from "./GraphView";

// Shared spies/captures between the test and the hoisted mock factory.
const hoisted = vi.hoisted(() => ({
  reheat: vi.fn(),
  layoutRef: { current: null as GraphLayout | null },
}));

// Deterministic stand-in for the d3 layout: node i sits at world (i * 100, 0).
// The layout is memoised per graph (like the real hook) so a node pinned mid
// drag survives the component's re-renders. The view auto-fits, so tests derive
// screen coordinates from the same fit camera the component computes rather
// than assuming a 1:1 mapping.
vi.mock("@/hooks/useGraphSimulation", () => {
  const cache = new WeakMap<WorkspaceGraph, GraphLayout>();
  return {
    useGraphSimulation: (graph: WorkspaceGraph) => {
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
      hoisted.layoutRef.current = layout;
      return { layout, version: 1, settled: true, reheat: hoisted.reheat };
    },
  };
});

const FILES = ["/v/a.md", "/v/b.md"];
const REFS: WikilinkRef[] = [{ source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" }];
const VIEWPORT = { width: 800, height: 600 };

// The fit camera the component lands on for the mock layout, and where each
// node ends up on screen under it.
const FIT_NODES: LayoutNode[] = buildWorkspaceGraph(FILES, REFS).nodes.map((n, i) => ({
  ...n,
  x: i * 100,
  y: 0,
}));
const FIT = fitCameraToNodes(FIT_NODES, VIEWPORT);
const NODE_A = worldToScreen(FIT, VIEWPORT, 0, 0);
const EMPTY = { x: 40, y: 40 };

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

beforeEach(() => {
  hoisted.reheat.mockClear();
  hoisted.layoutRef.current = null;
  ctx = stubContext();
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
});

function renderGraph(onOpenFile = vi.fn()) {
  const utils = render(
    <GraphView workspaceFiles={FILES} wikilinkRefs={REFS} onOpenFile={onOpenFile} />,
  );
  return { ...utils, onOpenFile, canvas: screen.getByRole("img", { name: "Workspace graph" }) };
}

/** Scale + x-translation of the most recent world-transform draw call. */
function lastWorldTransform() {
  const calls = ctx.setTransform.mock.calls;
  const last = calls[calls.length - 1];
  return { scale: last[0] as number, tx: last[4] as number };
}

describe("GraphView", () => {
  it("shows an empty state when the workspace has no notes", () => {
    render(<GraphView workspaceFiles={[]} wikilinkRefs={[]} onOpenFile={vi.fn()} />);
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

  it("opens the clicked node's file", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: NODE_A.x, clientY: NODE_A.y });
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("does not open a file when clicking empty space", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: EMPTY.x, clientY: EMPTY.y });
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
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: NODE_A.x + 2, clientY: NODE_A.y + 1 });
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
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
    fireEvent.pointerUp(canvas, { pointerId: 3, clientX: NODE_A.x + 80, clientY: NODE_A.y });
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
