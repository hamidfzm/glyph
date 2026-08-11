import { afterEach, describe, expect, it, vi } from "vitest";
import { restoreMatchMedia, stubMatchMedia } from "@/test/matchMedia";
import { restoreRaf, stubRaf } from "@/test/raf";
import {
  createSpringAnimation,
  isSettled,
  SPRING_DEFAULT,
  type SpringState,
  stepSpring,
} from "./spring";

function run(from: number, target: number, config = SPRING_DEFAULT, velocity = 0) {
  let state: SpringState = { value: from, velocity };
  const values: number[] = [];
  for (let i = 0; i < 600 && !isSettled(state, target); i++) {
    state = stepSpring(state, target, config, 1 / 60);
    values.push(state.value);
  }
  return { state, values };
}

describe("stepSpring", () => {
  it("converges to the target", () => {
    const { state } = run(0, 1);
    expect(state.value).toBeCloseTo(1, 2);
    expect(isSettled(state, 1)).toBe(true);
  });

  it("never overshoots when critically damped", () => {
    const { values } = run(0, 1);
    for (const v of values) expect(v).toBeLessThanOrEqual(1.001);
  });

  it("overshoots below damping ratio 1", () => {
    const { values } = run(0, 1, { response: 0.3, dampingRatio: 0.5 });
    expect(Math.max(...values)).toBeGreaterThan(1.01);
  });

  it("survives a huge frame gap without exploding", () => {
    const state = stepSpring({ value: 0, velocity: 0 }, 1, SPRING_DEFAULT, 5);
    expect(state.value).toBeGreaterThan(0);
    expect(state.value).toBeLessThanOrEqual(1.001);
  });

  it("an initial velocity carries the value along", () => {
    const pushed = stepSpring({ value: 0.5, velocity: -4 }, 1, SPRING_DEFAULT, 1 / 60);
    const still = stepSpring({ value: 0.5, velocity: 0 }, 1, SPRING_DEFAULT, 1 / 60);
    expect(pushed.value).toBeLessThan(still.value);
  });
});

describe("createSpringAnimation", () => {
  afterEach(() => {
    restoreRaf();
    restoreMatchMedia();
  });

  it("animates to the target and settles exactly on it", () => {
    const raf = stubRaf();
    const frames: number[] = [];
    const onSettle = vi.fn();
    const spring = createSpringAnimation({ initial: 0, onFrame: (v) => frames.push(v), onSettle });
    spring.animateTo(1);
    raf.settle();
    expect(frames[frames.length - 1]).toBe(1);
    expect(onSettle).toHaveBeenCalledWith(1);
    expect(spring.value()).toBe(1);
  });

  it("retargets mid-flight from the current value, without a jump", () => {
    const raf = stubRaf();
    const frames: number[] = [];
    const spring = createSpringAnimation({ initial: 0, onFrame: (v) => frames.push(v) });
    spring.animateTo(1);
    raf.frame();
    raf.frame();
    const grabbed = spring.value();
    expect(grabbed).toBeGreaterThan(0);
    spring.animateTo(0);
    raf.frame();
    const next = frames[frames.length - 1];
    expect(Math.abs(next - grabbed)).toBeLessThan(0.2);
    raf.settle();
    expect(spring.value()).toBe(0);
  });

  it("moveTo stops the loop and pins the value", () => {
    const raf = stubRaf();
    const spring = createSpringAnimation({ initial: 0, onFrame: () => {} });
    spring.animateTo(1);
    raf.frame();
    spring.moveTo(0.42);
    expect(spring.value()).toBe(0.42);
    expect(raf.pendingCount()).toBe(0);
  });

  it("stop freezes in place without settling", () => {
    const raf = stubRaf();
    const onSettle = vi.fn();
    const spring = createSpringAnimation({ initial: 0, onFrame: () => {}, onSettle });
    spring.animateTo(1);
    raf.frame();
    spring.stop();
    expect(raf.pendingCount()).toBe(0);
    expect(onSettle).not.toHaveBeenCalled();
    expect(spring.value()).toBeGreaterThan(0);
    expect(spring.value()).toBeLessThan(1);
  });

  it("a handed-off velocity moves the first frames faster", () => {
    const raf = stubRaf();
    let coasted = 0;
    const spring = createSpringAnimation({ initial: 0.5, onFrame: (v) => (coasted = v) });
    spring.animateTo(0, -6);
    raf.frame();
    const withVelocity = 0.5 - coasted;

    restoreRaf();
    const raf2 = stubRaf();
    let still = 0;
    const spring2 = createSpringAnimation({ initial: 0.5, onFrame: (v) => (still = v) });
    spring2.animateTo(0);
    raf2.frame();
    expect(withVelocity).toBeGreaterThan(0.5 - still);
  });

  it("snaps instantly under reduced motion", () => {
    stubMatchMedia(true);
    const raf = stubRaf();
    const frames: number[] = [];
    const onSettle = vi.fn();
    const spring = createSpringAnimation({ initial: 0, onFrame: (v) => frames.push(v), onSettle });
    spring.animateTo(1);
    expect(frames).toEqual([1]);
    expect(onSettle).toHaveBeenCalledWith(1);
    expect(raf.pendingCount()).toBe(0);
  });
});
