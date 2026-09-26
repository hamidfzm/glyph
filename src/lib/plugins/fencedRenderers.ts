import type { FencedRendererContribution, FencedRendererMount } from "./types";

/**
 * A mount renderer is an object with a `mount` function. Checked by shape, not
 * by `typeof render === "function"`: React's `memo` and `forwardRef`
 * components are objects too.
 */
export function isFencedRendererMount(
  render: FencedRendererContribution["render"],
): render is FencedRendererMount {
  return typeof (render as Partial<FencedRendererMount>).mount === "function";
}
