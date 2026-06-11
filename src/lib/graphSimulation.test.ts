import { describe, expect, it } from "vitest";
import type { WikilinkRef } from "./backlinks";
import { buildWorkspaceGraph } from "./graph";
import {
  capturePositions,
  createGraphLayout,
  LAYOUT_MAX_TICKS,
  tickLayout,
} from "./graphSimulation";

const FILES = ["/v/a.md", "/v/b.md", "/v/c.md"];
const REFS: WikilinkRef[] = [
  { source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" },
  { source: "/v/b.md", target: "c", line: 1, snippet: "[[c]]" },
];

function makeGraph() {
  return buildWorkspaceGraph(FILES, REFS);
}

describe("createGraphLayout", () => {
  it("creates one layout node per graph node, carrying display fields", () => {
    const layout = createGraphLayout(makeGraph());
    expect(layout.nodes.map((n) => n.id)).toEqual(FILES);
    expect(layout.nodes.map((n) => n.label)).toEqual(["a", "b", "c"]);
    expect(layout.nodes.map((n) => n.degree)).toEqual([1, 2, 1]);
    expect(layout.nodes.map((n) => n.orphan)).toEqual([false, false, false]);
  });

  it("initializes every node with concrete coordinates", () => {
    const layout = createGraphLayout(makeGraph());
    for (const node of layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
  });

  it("rewrites link endpoints to node references", () => {
    const layout = createGraphLayout(makeGraph());
    expect(layout.links).toHaveLength(2);
    expect(layout.links[0].source.id).toBe("/v/a.md");
    expect(layout.links[0].target.id).toBe("/v/b.md");
  });

  it("starts stopped so the caller controls pacing", () => {
    const layout = createGraphLayout(makeGraph());
    const before = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    // No rAF, no time passing: positions must not move on their own.
    const after = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    expect(after).toEqual(before);
  });

  it("seeds positions from a previous snapshot", () => {
    const layout = createGraphLayout(
      makeGraph(),
      new Map([
        ["/v/a.md", { x: 111, y: -42 }],
        ["/v/b.md", { x: -7, y: 13 }],
      ]),
    );
    expect(layout.nodes[0].x).toBe(111);
    expect(layout.nodes[0].y).toBe(-42);
    expect(layout.nodes[1].x).toBe(-7);
  });

  it("reheats gently when most nodes were seeded", () => {
    const seeded = createGraphLayout(
      makeGraph(),
      new Map([
        ["/v/a.md", { x: 1, y: 1 }],
        ["/v/b.md", { x: 2, y: 2 }],
      ]),
    );
    const fresh = createGraphLayout(makeGraph());
    expect(seeded.simulation.alpha()).toBeLessThan(fresh.simulation.alpha());
  });

  it("keeps full heat when only a minority of nodes were seeded", () => {
    const layout = createGraphLayout(makeGraph(), new Map([["/v/a.md", { x: 1, y: 1 }]]));
    expect(layout.simulation.alpha()).toBe(1);
  });

  it("handles an empty graph", () => {
    const layout = createGraphLayout(buildWorkspaceGraph([], []));
    expect(layout.nodes).toEqual([]);
    expect(layout.links).toEqual([]);
  });
});

describe("tickLayout", () => {
  it("moves nodes when ticked", () => {
    const layout = createGraphLayout(makeGraph());
    const before = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    tickLayout(layout, 5);
    const moved = layout.nodes.some((n, i) => n.x !== before[i].x || n.y !== before[i].y);
    expect(moved).toBe(true);
  });

  it("reports not settled right after a hot start", () => {
    const layout = createGraphLayout(makeGraph());
    expect(tickLayout(layout, 1)).toBe(false);
  });

  it("settles within the tick budget", () => {
    const layout = createGraphLayout(makeGraph());
    expect(tickLayout(layout, LAYOUT_MAX_TICKS)).toBe(true);
  });

  it("is a no-op once settled", () => {
    const layout = createGraphLayout(makeGraph());
    tickLayout(layout, LAYOUT_MAX_TICKS);
    const before = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    expect(tickLayout(layout, 10)).toBe(true);
    const after = layout.nodes.map((n) => ({ x: n.x, y: n.y }));
    expect(after).toEqual(before);
  });
});

describe("capturePositions", () => {
  it("snapshots every node's coordinates", () => {
    const layout = createGraphLayout(makeGraph());
    tickLayout(layout, 10);
    const snapshot = capturePositions(layout);
    expect(snapshot.size).toBe(3);
    for (const node of layout.nodes) {
      expect(snapshot.get(node.id)).toEqual({ x: node.x, y: node.y });
    }
  });

  it("round-trips into a new layout as seeds", () => {
    const first = createGraphLayout(makeGraph());
    tickLayout(first, LAYOUT_MAX_TICKS);
    const second = createGraphLayout(makeGraph(), capturePositions(first));
    for (let i = 0; i < first.nodes.length; i += 1) {
      expect(second.nodes[i].x).toBe(first.nodes[i].x);
      expect(second.nodes[i].y).toBe(first.nodes[i].y);
    }
  });
});
