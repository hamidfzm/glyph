import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribe to a CSS media query and re-render when it flips. Used for
 * viewport-width responsiveness (phone vs tablet/desktop): the app otherwise
 * only knows the OS family, not the screen size. Returns `false` where
 * `matchMedia` is unavailable, so a non-browser render never throws.
 */
export function useMediaQuery(query: string): boolean {
  // Memoised so the listener isn't torn down and rebuilt on every render; the
  // graph simulation reads this while re-rendering at frame rate.
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || !window.matchMedia) return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(subscribe, () =>
    typeof window !== "undefined" && window.matchMedia ? window.matchMedia(query).matches : false,
  );
}

// Split view (editor beside preview) and beside-the-content sidebars need a
// tablet-sized window. Both dimensions are checked so a phone in landscape
// (wide but short) still counts as compact, keeping the split off and the
// sidebars as drawers.
export const TABLET_QUERY = "(min-width: 768px) and (min-height: 600px)";

/** True when the viewport is large enough for the split view / beside sidebars. */
export function useCanSplit(): boolean {
  return useMediaQuery(TABLET_QUERY);
}
