import { useEffect, useRef } from "react";
import { DisposerBag } from "@/lib/plugins/disposer";
import type { FencedRendererMount, FencedRendererProps } from "@/lib/plugins/types";

/**
 * Host element for a framework-agnostic fenced renderer. Mounts it in an
 * effect, and on unmount or any prop change runs its cleanups and clears the
 * DOM before mounting again. A throwing mount is contained here so one bad
 * plugin can't take down the document.
 */
export function FencedMountSlot({
  renderer,
  code,
  openLightbox,
}: FencedRendererProps & { renderer: FencedRendererMount }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bag = new DisposerBag();
    try {
      renderer.mount(el, { code, openLightbox }, (cleanup) => bag.add(cleanup));
    } catch (err) {
      console.error("A plugin fenced renderer threw in mount():", err);
    }
    return () => {
      bag.dispose();
      el.replaceChildren();
    };
  }, [renderer, code, openLightbox]);

  return <div ref={ref} />;
}
