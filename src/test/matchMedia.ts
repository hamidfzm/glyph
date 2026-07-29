import { vi } from "vitest";

/**
 * Minimal MediaQueryList stub that records its change listeners, so a test can
 * flip `matches` and fire them the way a resize, rotation, or OS preference
 * change would. Restore with `restoreMatchMedia` in `afterEach`.
 */
export function stubMatchMedia(matches: boolean) {
  const listeners = new Set<() => void>();
  const mql = {
    matches,
    addEventListener: vi.fn((_: string, fn: () => void) => {
      listeners.add(fn);
    }),
    removeEventListener: vi.fn((_: string, fn: () => void) => {
      listeners.delete(fn);
    }),
  };
  const matchMedia = vi.fn(() => mql);
  window.matchMedia = matchMedia as unknown as typeof window.matchMedia;
  return {
    matchMedia,
    mql,
    fire(next: boolean) {
      mql.matches = next;
      for (const fn of listeners) fn();
    },
    listenerCount: () => listeners.size,
  };
}

const originalMatchMedia = window.matchMedia;

export function restoreMatchMedia() {
  window.matchMedia = originalMatchMedia;
}
