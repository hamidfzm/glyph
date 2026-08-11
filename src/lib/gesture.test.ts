import { describe, expect, it } from "vitest";
import {
  createVelocityTracker,
  drawerOpenSign,
  drawerPhysicalEdge,
  drawerReleaseTarget,
  project,
  rubberband,
} from "./gesture";

describe("createVelocityTracker", () => {
  it("measures px/s over the recent samples", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 0);
    tracker.add(50, 50);
    tracker.add(100, 100);
    expect(tracker.velocity(100)).toBe(1000);
  });

  it("ignores movement older than the window: a pause reads as a place, not a flick", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 0);
    tracker.add(200, 80);
    tracker.add(200, 400);
    expect(tracker.velocity(400)).toBe(0);
  });

  it("returns 0 without at least two samples", () => {
    const tracker = createVelocityTracker();
    expect(tracker.velocity(0)).toBe(0);
    tracker.add(10, 0);
    expect(tracker.velocity(0)).toBe(0);
  });

  it("returns 0 when samples share a timestamp", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 5);
    tracker.add(40, 5);
    expect(tracker.velocity(5)).toBe(0);
  });

  it("reset clears the history", () => {
    const tracker = createVelocityTracker();
    tracker.add(0, 0);
    tracker.add(100, 50);
    tracker.reset();
    tracker.add(0, 60);
    expect(tracker.velocity(60)).toBe(0);
  });
});

describe("project", () => {
  it("uses exponential scroll decay", () => {
    expect(project(1000)).toBeCloseTo(499, 0);
  });

  it("keeps the sign of the velocity", () => {
    expect(project(-500)).toBeLessThan(0);
    expect(project(0)).toBe(0);
  });
});

describe("rubberband", () => {
  it("resists progressively and never exceeds the dimension", () => {
    const small = rubberband(10, 300);
    const large = rubberband(200, 300);
    const huge = rubberband(100000, 300);
    expect(small).toBeGreaterThan(0);
    expect(large).toBeGreaterThan(small);
    expect(huge).toBeLessThan(300);
  });

  it("follows closely near the edge", () => {
    expect(rubberband(10, 300)).toBeGreaterThan(4);
    expect(rubberband(10, 300)).toBeLessThan(10);
  });
});

describe("drawerOpenSign", () => {
  it("flips the axis for a right-edge drawer", () => {
    expect(drawerOpenSign("left")).toBe(1);
    expect(drawerOpenSign("right")).toBe(-1);
  });
});

describe("drawerPhysicalEdge", () => {
  it("mirrors the slot side only under RTL", () => {
    expect(drawerPhysicalEdge("left", false)).toBe("left");
    expect(drawerPhysicalEdge("right", false)).toBe("right");
    expect(drawerPhysicalEdge("left", true)).toBe("right");
    expect(drawerPhysicalEdge("right", true)).toBe("left");
  });
});

describe("drawerReleaseTarget", () => {
  it("settles open past the midpoint with no momentum", () => {
    expect(drawerReleaseTarget(180, 0, 300)).toBe(1);
    expect(drawerReleaseTarget(120, 0, 300)).toBe(0);
  });

  it("a flick toward closed dismisses even from an open position", () => {
    expect(drawerReleaseTarget(220, -600, 300)).toBe(0);
  });

  it("a flick toward open keeps it open even from a closed position", () => {
    expect(drawerReleaseTarget(80, 600, 300)).toBe(1);
  });
});
