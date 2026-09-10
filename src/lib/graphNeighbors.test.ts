import { describe, expect, it } from "vitest";
import { neighborIndex } from "./graphNeighbors";

describe("neighborIndex", () => {
  it("links both ends of every edge", () => {
    const neighbors = neighborIndex([{ source: "a", target: "b" }]);
    expect([...(neighbors.get("a") ?? [])]).toEqual(["b"]);
    expect([...(neighbors.get("b") ?? [])]).toEqual(["a"]);
  });

  it("collects every neighbour of a note that sits on several edges", () => {
    const neighbors = neighborIndex([
      { source: "hub", target: "a" },
      { source: "b", target: "hub" },
    ]);
    expect([...(neighbors.get("hub") ?? [])].sort()).toEqual(["a", "b"]);
  });

  it("leaves a note with no edges out", () => {
    expect(neighborIndex([]).size).toBe(0);
  });
});
