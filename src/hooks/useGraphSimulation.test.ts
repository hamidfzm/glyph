import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { WikilinkRef } from "@/lib/backlinks";
import { buildWorkspaceGraph } from "@/lib/graph";
import { useGraphSimulation } from "./useGraphSimulation";

const FILES = ["/v/a.md", "/v/b.md", "/v/c.md"];
const REFS: WikilinkRef[] = [
  { source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" },
  { source: "/v/b.md", target: "c", line: 1, snippet: "[[c]]" },
];

// High ticksPerFrame keeps the rAF count low so tests settle in a few frames.
const FAST = { ticksPerFrame: 100 };

describe("useGraphSimulation", () => {
  it("exposes a layout for the given graph immediately", () => {
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    expect(result.current.layout.nodes.map((n) => n.id)).toEqual(FILES);
    expect(result.current.settled).toBe(false);
    unmount();
  });

  it("ticks the simulation until it settles and bumps version each frame", async () => {
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.version).toBeGreaterThan(0);
    for (const node of result.current.layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    unmount();
  });

  it("stops at the maxTicks cap even when not converged", async () => {
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() =>
      useGraphSimulation(graph, { ticksPerFrame: 5, maxTicks: 5 }),
    );
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    // One batch of 5 ticks => exactly one version bump.
    expect(result.current.version).toBe(1);
    unmount();
  });

  it("seeds the next layout from the previous run when the graph changes", async () => {
    const graphA = buildWorkspaceGraph(FILES, REFS);
    const { result, rerender, unmount } = renderHook(
      ({ graph }) => useGraphSimulation(graph, FAST),
      { initialProps: { graph: graphA } },
    );
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    const settledPositions = new Map(
      result.current.layout.nodes.map((n) => [n.id, { x: n.x, y: n.y }]),
    );

    // Same files, one new ref — simulates a watcher-driven re-index.
    const graphB = buildWorkspaceGraph(FILES, [
      ...REFS,
      { source: "/v/c.md", target: "a", line: 1, snippet: "[[a]]" },
    ]);
    rerender({ graph: graphB });
    // The new layout must start from the captured positions, not from scratch.
    for (const node of result.current.layout.nodes) {
      expect(node.x).toBe(settledPositions.get(node.id)?.x);
      expect(node.y).toBe(settledPositions.get(node.id)?.y);
    }
    expect(result.current.layout.simulation.alpha()).toBeLessThan(1);
    unmount();
  });

  it("handles an empty graph without spinning", async () => {
    const graph = buildWorkspaceGraph([], []);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.layout.nodes).toEqual([]);
    unmount();
  });

  it("falls back to default tick pacing when no options are passed", async () => {
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    for (const node of result.current.layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
    }
    unmount();
  });
});
