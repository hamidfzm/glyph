import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CAMERA } from "./graphCanvas";
import { clearGraphView, loadGraphView, pruneGraphViews, saveGraphView } from "./graphViewStore";

const ROOT = "/vault";

afterEach(() => {
  clearGraphView(ROOT);
  clearGraphView("/other");
});

describe("graphViewStore", () => {
  it("has nothing for a key that was never written", () => {
    expect(loadGraphView(ROOT)).toBeUndefined();
  });

  it("round-trips a saved slice", () => {
    saveGraphView(ROOT, { camera: DEFAULT_CAMERA, autoFit: false });
    expect(loadGraphView(ROOT)).toEqual({ camera: DEFAULT_CAMERA, autoFit: false });
  });

  it("merges a patch instead of replacing the entry", () => {
    const positions = new Map([["a.md", { x: 1, y: 2 }]]);
    saveGraphView(ROOT, { positions });
    saveGraphView(ROOT, { camera: DEFAULT_CAMERA, autoFit: false });

    // The camera write must not drop the positions the simulation stored.
    expect(loadGraphView(ROOT)).toEqual({ positions, camera: DEFAULT_CAMERA, autoFit: false });
  });

  it("keeps workspaces apart", () => {
    saveGraphView(ROOT, { autoFit: false });
    expect(loadGraphView("/other")).toBeUndefined();
  });

  it("forgets a cleared key", () => {
    saveGraphView(ROOT, { autoFit: false });
    clearGraphView(ROOT);
    expect(loadGraphView(ROOT)).toBeUndefined();
  });

  it("prunes the entries whose graph tab is gone and keeps the rest", () => {
    saveGraphView(ROOT, { autoFit: false });
    saveGraphView("/other", { autoFit: false });

    pruneGraphViews(new Set([ROOT]));
    expect(loadGraphView(ROOT)).toEqual({ autoFit: false });
    expect(loadGraphView("/other")).toBeUndefined();
  });

  it("empties the store when no graph tab is left", () => {
    saveGraphView(ROOT, { autoFit: false });
    pruneGraphViews(new Set());
    expect(loadGraphView(ROOT)).toBeUndefined();
  });
});
