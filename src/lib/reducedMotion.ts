export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Scroll behavior for `scrollIntoView`. An explicit "smooth" animates whatever
 * the CSS `scroll-behavior` says, so the global reset in `app.css` cannot cover
 * these call sites and they have to ask. Components read the preference
 * through `useReducedMotion` instead.
 */
export function scrollBehavior(): ScrollBehavior {
  const canAsk = typeof window !== "undefined" && Boolean(window.matchMedia);
  if (canAsk && window.matchMedia(REDUCED_MOTION_QUERY).matches) return "instant";
  return "smooth";
}
