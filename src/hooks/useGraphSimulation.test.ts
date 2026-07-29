import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WikilinkRef } from "@/lib/backlinks";
import { buildWorkspaceGraph } from "@/lib/graph";
import { useGraphSimulation } from "./useGraphSimulation";

const { reducedMotion } = vi.hoisted(() => ({ reducedMotion: { value: false } }));
vi.mock("./useReducedMotion", () => ({
  useReducedMotion: () => reducedMotion.value,
}));

afterEach(() => {
  reducedMotion.value = false;
});

const FILES = ["/v/a.md", "/v/b.md", "/v/c.md"];
const REFS: WikilinkRef[] = [
  { source: "/v/a.md", target: "b", line: 1, snippet: "[[b]]" },
  { source: "/v/b.md", target: "c", line: 1, snippet: "[[c]]" },
];

// High ticksPerFrame keeps the rAF count low so tests settle in a few frames.
const FAST = { ticksPerFrame: 100 };
// Enough frames to interrupt a pass while it is still in flight.
const SLOW = { ticksPerFrame: 10 };

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
    // Every frame paints, so the layout is seen moving rather than jumping.
    expect(result.current.version).toBeGreaterThan(1);
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

  it("paints once at the end when reduced motion is on", async () => {
    reducedMotion.value = true;
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });

    // The layout still runs across frames (a synchronous pass would block the
    // thread), but only the settled state is painted, so nothing animates.
    expect(result.current.version).toBe(1);
    for (const node of result.current.layout.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }
    unmount();
  });

  it("keeps painting every frame during a reheat under reduced motion", async () => {
    reducedMotion.value = true;
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    const versionWhenSettled = result.current.version;

    // A reheat tracks the pointer during a drag, so it must not withhold frames.
    act(() => {
      result.current.reheat();
    });
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.version - versionWhenSettled).toBeGreaterThan(1);
    unmount();
  });

  it("starts painting when a reheat lands on a pass that is still in flight", async () => {
    reducedMotion.value = true;
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, SLOW));
    // Grabbing a node before the first pass settles must upgrade that pass,
    // otherwise the canvas stays frozen for the whole drag.
    expect(result.current.settled).toBe(false);
    act(() => {
      result.current.reheat();
    });

    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.version).toBeGreaterThan(1);
    unmount();
  });

  it("switches to animating when the preference is turned off mid-layout", async () => {
    reducedMotion.value = true;
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, rerender, unmount } = renderHook(() => useGraphSimulation(graph, SLOW));
    expect(result.current.settled).toBe(false);

    reducedMotion.value = false;
    rerender();
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.version).toBeGreaterThan(1);
    unmount();
  });

  it("resumes animating when reheated after settling", async () => {
    const graph = buildWorkspaceGraph(FILES, REFS);
    const { result, unmount } = renderHook(() => useGraphSimulation(graph, FAST));
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    const versionWhenSettled = result.current.version;

    // Two synchronous reheats: the second hits the "loop already running" guard.
    act(() => {
      result.current.reheat();
      result.current.reheat();
    });
    // Reheat un-settles the simulation and runs at least one more frame.
    await waitFor(() => expect(result.current.settled).toBe(true), { timeout: 5000 });
    expect(result.current.version).toBeGreaterThan(versionWhenSettled);
    unmount();
  });
});
