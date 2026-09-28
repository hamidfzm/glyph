// Diagram plugins (Mermaid, D2) bake the app theme's colors into the rendered
// SVG, so printing a dark-mode document puts dark boxes with dark labels on
// white paper, and no print stylesheet can override the baked `fill` values.
// Swap every live plugin block for its light static render before printing;
// the returned callback restores the originals afterwards.

import { staticRendererFor } from "@/lib/plugins/staticRenderers";

export async function swapDiagramsLight(doc: Document): Promise<() => void> {
  const restores: Array<() => void> = [];

  // Plugin blocks are React-owned, so the light render goes in beside the live
  // one (hidden, not replaced) and comes back out on restore.
  for (const block of Array.from(doc.querySelectorAll<HTMLElement>("[data-fenced-language]"))) {
    // The selector guarantees the attribute.
    const renderStatic = staticRendererFor(block.dataset.fencedLanguage as string);
    if (!renderStatic) continue;
    try {
      const markup = await renderStatic(block.dataset.fencedSource ?? "");
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
