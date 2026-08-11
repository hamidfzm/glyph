// Pure gesture math for momentum-driven surfaces (the drawer sheet). The
// pointer-event plumbing lives in hooks; everything here is testable data-in
// data-out. See docs/motion.md.

export interface VelocityTracker {
  add(position: number, time: number): void;
  /** Velocity in px/s over the recent samples; 0 when there aren't enough. */
  velocity(time: number): number;
  reset(): void;
}

// Only the last ~100ms of movement should count: a long drag that pauses
// before release is a place, not a flick.
const VELOCITY_WINDOW_MS = 100;

export function createVelocityTracker(): VelocityTracker {
  let samples: { position: number; time: number }[] = [];
  return {
    add(position, time) {
      samples.push({ position, time });
      samples = samples.filter((s) => time - s.time <= VELOCITY_WINDOW_MS);
    },
    velocity(time) {
      const recent = samples.filter((s) => time - s.time <= VELOCITY_WINDOW_MS);
      if (recent.length < 2) return 0;
      const first = recent[0];
      const last = recent[recent.length - 1];
      const elapsedMs = last.time - first.time;
      if (elapsedMs <= 0) return 0;
      return ((last.position - first.position) / elapsedMs) * 1000;
    },
    reset() {
      samples = [];
    },
  };
}

// Scroll-style deceleration; 0.998 is the normal-scroll feel.
const DECELERATION_RATE = 0.998;

/**
 * How far a flick coasts before stopping (scroll-style exponential decay),
 * so a release animates to where the gesture was going, not where it ended.
 */
export function project(velocity: number): number {
  return ((velocity / 1000) * DECELERATION_RATE) / (1 - DECELERATION_RATE);
}

// How much of the overshoot a rubberbanded surface still follows.
const RUBBERBAND_CONSTANT = 0.55;

/** Progressive resistance past an edge: follows less the further past it. */
export function rubberband(overshoot: number, dimension: number): number {
  return (
    (overshoot * dimension * RUBBERBAND_CONSTANT) /
    (dimension + RUBBERBAND_CONSTANT * Math.abs(overshoot))
  );
}

/** Sign that maps pointer-x movement onto "toward open" for a drawer edge. */
export function drawerOpenSign(edge: "left" | "right"): 1 | -1 {
  return edge === "left" ? 1 : -1;
}

/** The physical screen edge of a drawer slot once RTL mirroring is applied. */
export function drawerPhysicalEdge(side: "left" | "right", rtl: boolean): "left" | "right" {
  if (!rtl) return side;
  return side === "left" ? "right" : "left";
}

/**
 * Where a released drawer goes: project the momentum forward and snap to the
 * nearer end. `position` is px from fully closed, `velocity` px/s toward open.
 */
export function drawerReleaseTarget(position: number, velocity: number, width: number): 0 | 1 {
  const projected = position + project(velocity);
  return projected < width / 2 ? 0 : 1;
}
