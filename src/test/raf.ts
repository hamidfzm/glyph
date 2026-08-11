import { type MockInstance, vi } from "vitest";

let nowSpy: MockInstance | null = null;

/**
 * Replace requestAnimationFrame (and performance.now) with a manual pump so
 * tests drive spring frames deterministically. Restore with `restoreRaf` in
 * `afterEach`.
 */
export function stubRaf() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, FrameRequestCallback>();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    const id = nextId++;
    pending.set(id, cb);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    pending.delete(id);
  });
  nowSpy = vi.spyOn(performance, "now").mockImplementation(() => now);
  return {
    frame(ms = 16) {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      for (const cb of callbacks) cb(now);
    },
    /** Pump frames until every animation settles (or the cap trips). */
    settle(maxFrames = 600) {
      let i = 0;
      while (pending.size > 0 && i < maxFrames) {
        this.frame();
        i += 1;
      }
    },
    pendingCount: () => pending.size,
  };
}

// Restores only what stubRaf touched, so a file's other mocks survive.
export function restoreRaf() {
  vi.unstubAllGlobals();
  nowSpy?.mockRestore();
  nowSpy = null;
}
