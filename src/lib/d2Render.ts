// Lazy D2 renderer + render cache. Pure logic (no JSX) shared by the on-screen
// `D2Diagram` component and the PDF export rasterizer, so it lives in `lib`
// rather than under `components`. `@terrastruct/d2`'s browser build inlines the
// multi-MB WASM and runs it in a blob-URL worker, so the dynamic import is fully
// self-contained and makes no network request — the diagram renders offline.

import type { CompileOptions, Diagram, RenderOptions } from "@terrastruct/d2";
import DOMPurify from "dompurify";

// The shipped `D2` class types `compile`'s second argument as
// `Omit<CompileRequest, "fs">` ({ inputPath?, options }), but the runtime treats
// it as a flat `CompileOptions` (it builds `{ fs, options: t }` from a string
// input). We model that real contract here and cast the instance to it so our
// call sites are correctly typed instead of matching the package's bug.
interface D2Compiler {
  compile(
    input: string,
    options?: CompileOptions,
  ): Promise<{ diagram: Diagram; renderOptions: RenderOptions }>;
  render(diagram: Diagram, options?: RenderOptions): Promise<string>;
}

let d2Promise: Promise<D2Compiler> | null = null;

function loadD2(): Promise<D2Compiler> {
  if (!d2Promise) {
    d2Promise = import("@terrastruct/d2").then((m) => new m.D2() as unknown as D2Compiler);
  }
  return d2Promise;
}

// D2's built-in theme ids: 0 = Neutral default (light), 200 = Dark Mauve (dark).
const LIGHT_THEME_ID = 0;
const DARK_THEME_ID = 200;

// Rendered+sanitized SVG keyed by `${theme}:${source}` so re-renders (scroll,
// tab switch, parent re-render, reopening an unchanged doc) skip the expensive
// WASM layout. Promises are cached (not strings) so concurrent renders of the
// same diagram share one compile; failures are evicted so they can be retried.
const cache = new Map<string, Promise<string>>();

// The rendered SVG is untrusted (it derives from arbitrary D2 source) and is
// injected via innerHTML, so sanitize before it reaches the DOM. DOMPurify's
// default config already drops <script>, on* handlers, and javascript:/external
// href references while keeping SVG elements; we additionally forbid
// <foreignObject>, the SVG-embedded-HTML XSS vector. Note: this also strips D2's
// foreignObject-based markdown/code blocks, an accepted trade-off — the XSS
// guard outweighs those rare embeds.
function sanitizeSvg(svg: string): string {
  return DOMPurify.sanitize(svg, { FORBID_TAGS: ["foreignObject"] });
}

/** Compile and render a D2 source to sanitized SVG, served from cache when the
 *  same source has already been rendered for the same theme. */
export function renderD2(source: string, dark: boolean): Promise<string> {
  const key = `${dark ? "dark" : "light"}:${source}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = (async () => {
    const d2 = await loadD2();
    const result = await d2.compile(source, { themeID: dark ? DARK_THEME_ID : LIGHT_THEME_ID });
    const svg = await d2.render(result.diagram, { ...result.renderOptions, noXMLTag: true });
    return sanitizeSvg(svg);
  })();
  // Don't cache a failed render, so a transient error can be retried.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  return pending;
}
