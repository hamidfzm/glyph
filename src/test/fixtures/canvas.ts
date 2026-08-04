import { act } from "@testing-library/react";
import type { vi } from "vitest";
import { parseCanvas } from "@/lib/canvas/parse";

// Board fixtures and DOM readers shared by the CanvasEditor suites.

export const empty = JSON.stringify({ nodes: [], edges: [] });
export const oneText = JSON.stringify({
  nodes: [{ id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "Hello" }],
  edges: [],
});
export const twoNodes = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "A" },
    { id: "b", type: "text", x: 300, y: 0, width: 200, height: 80, text: "B" },
  ],
  edges: [],
});
export const withEdge = JSON.stringify({
  nodes: [
    { id: "a", type: "text", x: 0, y: 0, width: 200, height: 80, text: "A" },
    { id: "b", type: "text", x: 300, y: 0, width: 200, height: 80, text: "B" },
  ],
  edges: [{ id: "e", fromNode: "a", toNode: "b" }],
});

// Commit-on-end is deferred one microtask (StrictMode-safe cleanup), so tests
// ending an edit indirectly must flush before asserting. Wrapped in act so the
// deferred commit's state updates land inside it.
export const flushMicrotasks = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

export const lastData = (onChange: ReturnType<typeof vi.fn>) =>
  parseCanvas(onChange.mock.calls.at(-1)?.[0] as string);
export const stageOf = (c: HTMLElement) => c.querySelector(".glyph-canvas-stage") as Element;
export const nodesOf = (c: HTMLElement) => Array.from(c.querySelectorAll(".glyph-canvas-node"));
