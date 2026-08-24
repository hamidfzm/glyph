// Lazy Mermaid loader + render cache, mirroring d2Render. Pure logic (no JSX)
// so the on-screen `MermaidDiagram` component and tests share it. The export
// path (`renderMermaidLightSvg`) deliberately stays separate: it re-renders
// with different options once per export, off the hot path.

import { DIAGRAM_RENDER_CACHE_LIMIT, LruCache } from "@/lib/lruCache";

let idCounter = 0;
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

// Rendered SVG keyed by `${theme}:${source}` so re-renders (scroll, tab
// switch, parent re-render, reopening an unchanged doc) skip Mermaid's parse
// and layout. Promises are cached (not strings) so concurrent mounts of the
// same diagram share one render; failures are evicted so they can be retried.
const cache = new LruCache<Promise<string>>(DIAGRAM_RENDER_CACHE_LIMIT);

// `mermaid.initialize()` sets global config; the theme is not a per-render
// argument the way D2's `themeID` is, so two initialize+render pairs could
// interleave and steal each other's theme. Chaining every pair on this queue
// makes that impossible, as long as everything that touches `initialize` goes
// through `enqueueMermaid` (the export path does). Rejections are absorbed so
// one broken diagram cannot stall the queue; a render that never settles would
// stall later diagrams, accepted because Mermaid's layout is CPU-bound (a real
// hang freezes the main thread regardless of any queue).
let queue: Promise<unknown> = Promise.resolve();

/** Run a Mermaid initialize+render pair after every previously queued pair.
 *  Mermaid's config is global, so an unqueued pair can steal the theme out
 *  from under a queued one mid-render. */
export function enqueueMermaid<T>(work: () => Promise<T>): Promise<T> {
  const pending = queue.then(work);
  queue = pending.catch(() => {});
  return pending;
}

/** Render a Mermaid source to SVG, served from cache when the same source has
 *  already been rendered for the same theme. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}:${source}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = enqueueMermaid(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      theme: dark ? "dark" : "default",
    });
    // Always pass a fresh id. Mermaid v11 keeps internal state keyed by id,
    // and a reused id returns a tiny stub SVG that paints as a blank preview.
    const { svg } = await mermaid.render(`mermaid-diagram-${idCounter++}`, source);
    return svg;
  });
  // Don't cache a failed render, so a transient error can be retried. Evict
  // only the promise that actually failed: past the LRU bound the key may
  // have been evicted and re-inserted with a newer, healthy promise.
  pending.catch(() => {
    if (cache.peek(key) === pending) cache.delete(key);
  });
  cache.set(key, pending);
  return pending;
}
