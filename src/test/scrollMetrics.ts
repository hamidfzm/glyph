const VIEWPORT = 500;

/** happy-dom reports every element as 0x0, so scrollable ranges are declared here. */
export function sizeScroller(el: HTMLElement, range: number) {
  Object.defineProperty(el, "clientHeight", { value: VIEWPORT, configurable: true });
  Object.defineProperty(el, "scrollHeight", { value: VIEWPORT + range, configurable: true });
}
