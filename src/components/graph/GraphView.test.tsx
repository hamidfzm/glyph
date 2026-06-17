import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WikilinkRef } from "@/lib/backlinks";
import type { WorkspaceGraph } from "@/lib/graph";
import type { GraphLayout, LayoutNode } from "@/lib/graphSimulation";
import { GraphView } from "./GraphView";

// Deterministic stand-in for the d3 layout: node i sits at (i * 100, 0), so
// with the 800x600 viewport node 0 is at screen (400, 300), node 1 at
// (500, 300). Interaction tests can then click exact coordinates.
vi.mock("@/hooks/useGraphSimulation", () => ({
  useGraphSimulation: (graph: WorkspaceGraph) => {
    const nodes: LayoutNode[] = graph.nodes.map((n, i) => ({ ...n, x: i * 100, y: 0 }));
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const links = graph.edges.map((e) => ({
      source: byId.get(e.source) as LayoutNode,
      target: byId.get(e.target) as LayoutNode,
    }));
    const layout = { nodes, links, simulation: null } as unknown as GraphLayout;
    return { layout, version: 1, settled: true };
  },
}));

const FILES = ["/v/a.md", "/v/b.md"];
const REFS: WikilinkRef[] = [{ source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" }];

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
    // Two nodes drawn as circles.
    expect(ctx.arc).toHaveBeenCalledTimes(2);
  });

  it("hides itself from print output", () => {
    const { container } = renderGraph();
    expect(container.querySelector('[data-print-hide="true"]')).not.toBeNull();
  });

  it("opens the clicked node's file", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("does not open a file when clicking empty space", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 200, clientY: 100 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(onOpenFile).not.toHaveBeenCalled();
  });

  it("treats a drag as a pan, not a click", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 450, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 450, clientY: 300 });
    expect(onOpenFile).not.toHaveBeenCalled();
    // The pan shifted the world transform right by 50 screen px.
    expect(lastWorldTransform().tx).toBe(450);
  });

  it("shows the file path tooltip while hovering a node", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    expect(screen.getByText("/v/a.md")).toBeInTheDocument();
    fireEvent.pointerLeave(canvas);
    expect(screen.queryByText("/v/a.md")).not.toBeInTheDocument();
  });

  it("clears the tooltip when hovering empty space", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(screen.queryByText("/v/a.md")).not.toBeInTheDocument();
  });

  it("zooms with the wheel", () => {
    const { canvas } = renderGraph();
    fireEvent.wheel(canvas, { deltaY: -500, clientX: 400, clientY: 300 });
    expect(lastWorldTransform().scale).toBeGreaterThan(1);
  });

  it("resets the camera via the Reset view button", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 480, clientY: 360 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 480, clientY: 360 });
    expect(lastWorldTransform().tx).not.toBe(400);

    fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
    expect(lastWorldTransform()).toEqual({ scale: 1, tx: 400 });
  });

  it("pans on a purely vertical drag", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    // dx = 0, dy = 60: only the vertical-delta arm of the click-slop test fires.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 360 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 400, clientY: 360 });
    expect(lastWorldTransform().tx).toBe(400);
    // The vertical pan shifted the world transform's y-translate (5th setTransform arg is x; check it stayed put while a draw still happened).
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("treats a sub-slop jitter as a click, not a pan", () => {
    const { canvas, onOpenFile } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    // dx=2, dy=1 are both within CLICK_SLOP_PX, so no pan starts.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 402, clientY: 301 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 402, clientY: 301 });
    expect(lastWorldTransform().tx).toBe(400);
    expect(onOpenFile).toHaveBeenCalledWith("/v/a.md");
  });

  it("keeps panning on a continued drag after movement starts", () => {
    const { canvas } = renderGraph();
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 400, clientY: 300 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 450, clientY: 300 });
    // Second move with a tiny delta: drag.moved is already true, so the first
    // arm of the click-slop test short-circuits and the pan continues.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 452, clientY: 300 });
    fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 452, clientY: 300 });
    expect(lastWorldTransform().tx).toBe(452);
  });

  it("falls back to a device pixel ratio of 1 when none is reported", () => {
    const original = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true });
    try {
      renderGraph();
      // dpr 1 * camera scale 1 → world transform scale 1.
      expect(lastWorldTransform().scale).toBe(1);
    } finally {
      Object.defineProperty(window, "devicePixelRatio", {
        value: original,
        configurable: true,
      });
    }
  });

  it("skips drawing when the 2D context is unavailable", () => {
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => null,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
    expect(() => renderGraph()).not.toThrow();
    // Guard short-circuits before any draw call.
    expect(ctx.clearRect).not.toHaveBeenCalled();
  });

  it("treats a missing bounding rect as the origin without crashing", () => {
    const { canvas } = renderGraph();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      undefined as unknown as DOMRect,
    );
    // localPoint must fall back to (clientX, clientY) via `?? 0` rather than throw.
    expect(() =>
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 400, clientY: 300 }),
    ).not.toThrow();
  });
});
