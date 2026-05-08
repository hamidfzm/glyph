// Smooth-scrolls to an anchor by id and notifies the outline so it can
// highlight the new active entry without waiting on the IntersectionObserver,
// which lags during programmatic scrolls.
const ACTIVE_HEADING_EVENT = "glyph:active-heading";

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
  target.scrollIntoView({ behavior: "smooth", block: autoBlock(target) });
  window.dispatchEvent(new CustomEvent(ACTIVE_HEADING_EVENT, { detail: { id } }));
  return true;
}

export function onActiveHeadingChange(handler: (id: string) => void): () => void {
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<{ id: string }>).detail;
    if (detail?.id) handler(detail.id);
  };
  window.addEventListener(ACTIVE_HEADING_EVENT, listener);
  return () => window.removeEventListener(ACTIVE_HEADING_EVENT, listener);
}
