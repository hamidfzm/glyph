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
// argument the way D2's `themeID` is, so two renders at different themes could
// interleave and steal each other's theme. Chaining every initialize+render
// pair on this queue makes that impossible. Failures are absorbed so one
// broken diagram cannot stall the queue.
let queue: Promise<unknown> = Promise.resolve();

/** Render a Mermaid source to SVG, served from cache when the same source has
 *  already been rendered for the same theme. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}:${source}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = queue.then(async () => {
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
  queue = pending.catch(() => {});
  // Don't cache a failed render, so a transient error can be retried.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  return pending;
}
