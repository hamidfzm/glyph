import { documentScroller } from "./scrollToHeading";

/**
 * The active document's rendered body, or null when none is mounted (an
 * editor-only tab, a canvas). Goes through the viewer's scroller: AI replies,
 * canvas cards, and notebook cells render `.markdown-body` too.
 */
export function documentBody(): HTMLElement | null {
  const scroller = documentScroller();
  if (!scroller) return null;
  return scroller.querySelector<HTMLElement>(".markdown-body, .notebook-body");
}
