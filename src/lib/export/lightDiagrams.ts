// Mermaid and D2 bake the app theme's colors into the rendered SVG, so printing
// a dark-mode document puts dark boxes with dark labels on white paper, and no
// print stylesheet can override the baked `fill` values. Swap every live
// diagram for a light re-render before printing; the returned callback restores
// the originals afterwards.

import { renderD2 } from "@/lib/d2Render";
import { renderMermaidLightSvg, restoreMermaidTheme } from "./rasterize";

export async function swapDiagramsLight(doc: Document): Promise<() => void> {
  const diagrams = Array.from(doc.querySelectorAll<HTMLElement>(".mermaid-diagram, .d2-diagram"));
  const restores: Array<() => void> = [];
  let mermaidRendered = false;

  for (const el of diagrams) {
    const isMermaid = el.classList.contains("mermaid-diagram");
    const source = el.getAttribute(isMermaid ? "data-mermaid-source" : "data-d2-source");
    if (!source) continue;
    const original = el.innerHTML;
    try {
      const svg = isMermaid ? await renderMermaidLightSvg(source) : await renderD2(source, false);
      // Unlike D2 (sanitized in d2Render) Mermaid's output is raw, and this goes
      // back into the live DOM; <foreignObject> is the SVG-embedded-HTML vector.
      const { default: DOMPurify } = await import("dompurify");
      el.innerHTML = DOMPurify.sanitize(svg, { FORBID_TAGS: ["foreignObject"] });
      if (isMermaid) mermaidRendered = true;
      restores.push(() => {
        el.innerHTML = original;
      });
    } catch {
      // Leave the on-screen diagram; a dark diagram beats a missing one.
    }
  }

  // renderMermaidLightSvg mutates Mermaid's global config.
  if (mermaidRendered) await restoreMermaidTheme(true);

  return () => {
    for (const restore of restores) restore();
  };
}
