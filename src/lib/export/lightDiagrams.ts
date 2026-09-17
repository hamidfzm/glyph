// Mermaid and D2 bake the app theme's colors into the rendered SVG, so printing
// a dark-mode document puts dark boxes with dark labels on white paper, and no
// print stylesheet can override the baked `fill` values. Swap every live
// diagram for a light re-render before printing; the returned callback restores
// the originals afterwards.

import { renderD2 } from "@/lib/d2Render";
import { staticRendererFor } from "@/lib/plugins/staticRenderers";
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

  // Plugin blocks are React-owned, so the light render goes in beside the live
  // one (hidden, not replaced) and comes back out on restore.
  for (const block of Array.from(doc.querySelectorAll<HTMLElement>("[data-fenced-language]"))) {
    const renderStatic = staticRendererFor(block.dataset.fencedLanguage ?? "");
    const source = block.dataset.fencedSource;
    if (!renderStatic || source === undefined) continue;
    try {
      const markup = await renderStatic(source);
      const { default: DOMPurify } = await import("dompurify");
      const light = doc.createElement("div");
      light.innerHTML = DOMPurify.sanitize(markup, { FORBID_TAGS: ["foreignObject"] });
      const live = Array.from(block.children) as HTMLElement[];
      const displays = live.map((child) => child.style.display);
      for (const child of live) child.style.display = "none";
      block.append(light);
      restores.push(() => {
        light.remove();
        live.forEach((child, i) => {
          child.style.display = displays[i];
        });
      });
    } catch {
      // Leave the on-screen render; a dark diagram beats a missing one.
    }
  }

  return () => {
    for (const restore of restores) restore();
  };
}
