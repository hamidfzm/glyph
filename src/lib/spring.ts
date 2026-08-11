import { REDUCED_MOTION_QUERY } from "./reducedMotion";

// Springs are parameterized the designer-facing way (response seconds +
// damping ratio) rather than mass/stiffness/damping. See docs/motion.md.
export interface SpringConfig {
  /** Roughly how long the spring takes to feel settled, in seconds. */
  response: number;
  /** 1 = critically damped (no overshoot); below 1 overshoots and oscillates. */
  dampingRatio: number;
}

/** Default for UI chrome: no overshoot, quick settle. */
export const SPRING_DEFAULT: SpringConfig = { response: 0.3, dampingRatio: 1 };

export interface SpringState {
  value: number;
  velocity: number;
}

// Semi-implicit Euler is only stable for stiff springs at small steps, and a
// backgrounded tab can hand rAF a multi-second gap, so integrate in fixed
// substeps and cap the total so a huge gap settles instead of exploding.
const SUBSTEP = 1 / 120;
const MAX_FRAME_DELTA = 0.25;

export function stepSpring(
  state: SpringState,
  target: number,
  config: SpringConfig,
  dt: number,
): SpringState {
  const omega = (2 * Math.PI) / config.response;
  const stiffness = omega * omega;
  const damping = 2 * config.dampingRatio * omega;
  let { value, velocity } = state;
  let remaining = Math.min(dt, MAX_FRAME_DELTA);
  while (remaining > 0) {
    const step = Math.min(remaining, SUBSTEP);
    const acceleration = -stiffness * (value - target) - damping * velocity;
    velocity += acceleration * step;
    value += velocity * step;
    remaining -= step;
  }
  return { value, velocity };
}

const REST_DELTA = 0.001;

export function isSettled(state: SpringState, target: number): boolean {
  return Math.abs(state.value - target) < REST_DELTA && Math.abs(state.velocity) < REST_DELTA * 10;
}

function prefersReducedMotion(): boolean {
  const canAsk = typeof window !== "undefined" && Boolean(window.matchMedia);
  return canAsk && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface SpringAnimation {
  /**
   * Animate toward a new target from the current value. Mid-flight calls
   * retarget without a jump; `velocity` (units/s) overrides the carried
   * velocity for gesture handoff.
   */
  animateTo(target: number, velocity?: number): void;
  /** Take over the value directly (a drag following the pointer); stops the loop. */
  moveTo(value: number): void;
  value(): number;
  /** Cancel the loop, keeping the current value. */
  stop(): void;
}

export function createSpringAnimation(options: {
  initial: number;
  config?: SpringConfig;
  onFrame: (value: number) => void;
  onSettle?: (target: number) => void;
}): SpringAnimation {
  const { config = SPRING_DEFAULT, onFrame, onSettle } = options;
  let state: SpringState = { value: options.initial, velocity: 0 };
  let target = options.initial;
  let frame = 0;
  let last = 0;

  const stopLoop = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  const tick = (now: number) => {
    state = stepSpring(state, target, config, (now - last) / 1000);
    last = now;
    if (isSettled(state, target)) {
      state = { value: target, velocity: 0 };
      frame = 0;
      onFrame(target);
      onSettle?.(target);
      return;
    }
    onFrame(state.value);
    frame = requestAnimationFrame(tick);
  };

  return {
    animateTo(next, velocity) {
      target = next;
      if (velocity !== undefined) state = { value: state.value, velocity };
      if (prefersReducedMotion() || typeof requestAnimationFrame === "undefined") {
        stopLoop();
        state = { value: next, velocity: 0 };
        onFrame(next);
        onSettle?.(next);
        return;
      }
      if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    moveTo(value) {
      stopLoop();
      state = { value, velocity: 0 };
      target = value;
      onFrame(value);
    },
    value: () => state.value,
    stop: stopLoop,
  };
}
