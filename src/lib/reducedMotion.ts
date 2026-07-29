export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Reads the OS preference outside React. Components use `useReducedMotion`. */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

/**
 * Scroll behavior for `scrollIntoView`. An explicit "smooth" animates whatever
 * the CSS `scroll-behavior` says, so the global reset in `app.css` cannot cover
 * these call sites and they have to ask.
 */
export function scrollBehavior(): ScrollBehavior {
  return prefersReducedMotion() ? "auto" : "smooth";
}
