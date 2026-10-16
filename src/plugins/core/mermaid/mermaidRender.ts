// Lazy Mermaid loader + render cache, shared by the on-screen renderer and the
// plugin's static (print, PDF, and site export) render.

import type { MermaidConfig } from "mermaid";
import { RenderCache } from "./renderCache";

let idCounter = 0;
let mermaidPromise: Promise<typeof import("mermaid").default> | null = null;
// DOMPurify is imported on demand so it stays out of the startup bundle.
let purifyPromise: Promise<typeof import("dompurify").default> | null = null;

function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((m) => m.default);
  }
  return mermaidPromise;
}

function loadPurify() {
  if (!purifyPromise) {
    purifyPromise = import("dompurify").then((m) => m.default);
  }
  return purifyPromise;
}

// `mermaid.initialize()` sets global config; the theme is not a per-render
// argument the way D2's `themeID` is, so two initialize+render pairs could
// interleave and steal each other's theme. Every pair is chained on this
// queue, and each one initializes in full (initialize resets to Mermaid's
// defaults first), so no render inherits another's options. Rejections are
// absorbed so one broken diagram cannot stall the queue; a render that never
// settles would stall later diagrams, accepted because Mermaid's layout is
// CPU-bound (a real hang freezes the main thread regardless of any queue).
let queue: Promise<unknown> = Promise.resolve();

function renderWith(config: MermaidConfig, source: string): Promise<string> {
  const pending = queue.then(async () => {
    const mermaid = await loadMermaid();
    // `strict` is Mermaid's default today; named so a future default cannot
    // widen what diagram source may put in the page.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", ...config });
    // Always pass a fresh id. Mermaid v11 keeps internal state keyed by id,
    // and a reused id returns a tiny stub SVG that paints as a blank preview.
    const { svg } = await mermaid.render(`mermaid-diagram-${idCounter++}`, source);
    return svg;
  });
  queue = pending.catch(() => {});
  return pending;
}

// The on-screen render lands in the document through `innerHTML`, so it gets
// the same pass the page renders get (see `renderTextLabels`), keeping the
// HTML labels the screen uses: DOMPurify sanitizes inside a `<foreignObject>`
// as it does any HTML. Mermaid's own sanitizer is the first line, not the only.
async function sanitizeLive(svg: string): Promise<string> {
  const DOMPurify = await loadPurify();
  const fragment = DOMPurify.sanitize(svg, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    RETURN_DOM_FRAGMENT: true,
  });
  return svgMarkup(fragment);
}

// Rendered SVG keyed by `${theme}:${source}` so re-renders (scroll, tab
// switch, parent re-render, reopening an unchanged doc) skip Mermaid's parse
// and layout. Promises are cached (not strings) so concurrent mounts of the
// same diagram share one render; failures are evicted so they can be retried.
const cache = new RenderCache<Promise<string>>();

/** Render a Mermaid source to SVG for the screen, served from cache when the
 *  same source has already been rendered for the same theme. */
export function renderMermaid(source: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}:${source}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = renderWith({ theme: dark ? "dark" : "default" }, source).then(sanitizeLive);
  // Don't cache a failed render, so a transient error can be retried. Evict
  // only the promise that actually failed: past the LRU bound the key may
  // have been evicted and re-inserted with a newer, healthy promise.
  pending.catch(() => {
    if (cache.peek(key) === pending) cache.delete(key);
  });
  cache.set(key, pending);
  return pending;
}

/**
 * Render a Mermaid source for a page rather than the screen: light, with SVG
 * text labels (no `<foreignObject>`, which pdfmake's SVG renderer can't draw
 * and which would taint a canvas in the raster fallback), sanitized. Returns
 * the SVG markup.
 */
export async function renderMermaidStatic(source: string): Promise<string> {
  const fragment = await renderTextLabels(source, false);
  // Mermaid backs every edge and cluster label with a filled `rect.background`
  // so labels stay readable where they cross an edge. On a printed page that
  // reads as a grey slab, worst over a colored subgraph, so the fill is
  // dropped. Inline styles win over the stylesheet rule that sets it.
  for (const rect of Array.from(fragment.querySelectorAll("rect.background"))) {
    (rect as SVGElement).style.setProperty("fill", "none");
  }
  // Mermaid's canvas is transparent, so a dark website page would show the
  // light diagram's dark lines on dark; paint it white like D2's.
  fragment.querySelector("svg")?.style.setProperty("background-color", "#fff");
  return svgMarkup(fragment);
}

/** The static render for a screen without a plugin host (the Windows Explorer
 *  preview): text labels and sanitized like the page render, in the given
 *  theme, with the label backgrounds kept. */
export async function renderMermaidPreview(source: string, dark: boolean): Promise<string> {
  return svgMarkup(await renderTextLabels(source, dark));
}

// Mermaid builds raw markup out of user-authored diagram source, so it is
// sanitized here, before any consumer can put it in a document;
// `<foreignObject>` is the SVG-embedded-HTML vector.
async function renderTextLabels(source: string, dark: boolean): Promise<DocumentFragment> {
  // Both flags are needed: with only the flowchart one, Mermaid v11 still
  // wraps every node label in a `<foreignObject>` and the labels vanish from
  // the PDF.
  const svg = await renderWith(
    {
      theme: dark ? "dark" : "default",
      htmlLabels: false,
      flowchart: { htmlLabels: false },
    },
    source,
  );
  const DOMPurify = await loadPurify();
  return DOMPurify.sanitize(svg, { FORBID_TAGS: ["foreignObject"], RETURN_DOM_FRAGMENT: true });
}

function svgMarkup(fragment: DocumentFragment): string {
  const root = fragment.querySelector("svg");
  if (!root) throw new Error("no svg in rendered diagram");
  return root.outerHTML;
}
