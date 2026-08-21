// Programmatic scrolling of the active document: to an anchor by id, or back to
// a remembered offset. An anchor jump also notifies the outline so it can
// highlight the new active entry without waiting on the IntersectionObserver,
// which lags during programmatic scrolls. Only these jumps dispatch that event;
// the navigation history relies on it to tell a jump from plain reading.
import { scrollBehavior } from "./reducedMotion";

const ACTIVE_HEADING_EVENT = "glyph:active-heading";

/** The viewer marks its scroll container; split layouts wrap the rendered pane
 *  in `.split-view-preview` so it can be told apart from a source pane. */
export const DOCUMENT_SCROLLER = "[data-scroll-container]";
export const PREVIEW_SCROLLER = `.split-view-preview ${DOCUMENT_SCROLLER}`;

// Pick `start` when the target can scroll to the top of its scroll container,
// otherwise `end`. Prevents end-of-document targets (the last heading, footnote
// refs) from disappearing into a half-scroll where the user can't tell whether
// the click navigated.
function autoBlock(target: HTMLElement): ScrollLogicalPosition {
  let scroller: HTMLElement | null = target.parentElement;
  while (scroller) {
    const overflowY = getComputedStyle(scroller).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") break;
    scroller = scroller.parentElement;
  }
  if (!scroller) return "start";
  const targetTopInScroller =
    target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  const maxScroll = scroller.scrollHeight - scroller.clientHeight;
  return targetTopInScroller <= maxScroll ? "start" : "end";
}

export function scrollToHeading(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ behavior: scrollBehavior(), block: autoBlock(target) });
  window.dispatchEvent(new CustomEvent(ACTIVE_HEADING_EVENT, { detail: { id } }));
  return true;
}

/** Put the active document's scroller (marked `data-scroll-container` by the
 *  viewer) back at `top`; a no-op when no document is mounted. Split layouts
 *  mount a source pane too, so the rendered pane under `.split-view-preview`
 *  wins when present. */
export function scrollDocumentTo(top: number): void {
  const scroller =
    document.querySelector<HTMLElement>(PREVIEW_SCROLLER) ??
    document.querySelector<HTMLElement>(DOCUMENT_SCROLLER);
  if (scroller) scroller.scrollTop = top;
}

export function onActiveHeadingChange(handler: (id: string) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string }>).detail;
    if (detail?.id) handler(detail.id);
  };
  window.addEventListener(ACTIVE_HEADING_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_HEADING_EVENT, listener);
}
