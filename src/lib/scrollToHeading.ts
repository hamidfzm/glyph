// Smooth-scrolls to a heading by id and notifies the outline so it can
// highlight the new active entry without waiting on the IntersectionObserver,
// which lags during programmatic scrolls.
const ACTIVE_HEADING_EVENT = "glyph:active-heading";

export function scrollToHeading(id: string): boolean {
  const target = document.getElementById(id);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
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
