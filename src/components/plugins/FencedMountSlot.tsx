import { useEffect, useRef } from "react";
import { DisposerBag } from "@/lib/plugins/disposer";
import type { FencedRendererMount, FencedRendererProps } from "@/lib/plugins/types";

/**
 * Host element for a framework-agnostic fenced renderer. A prop change (the
 * block's source edited in split view) runs the previous mount's cleanups and
 * mounts again over the previous render, so the renderer can keep it on
 * screen until the new one is ready. The element is cleared only when the
 * renderer changes or the block unmounts. A throwing mount is contained here
 * so one bad plugin can't take down the document.
 */
export function FencedMountSlot({
  renderer,
  code,
  openLightbox,
}: FencedRendererProps & { renderer: FencedRendererMount }) {
  const ref = useRef<HTMLDivElement>(null);
  const mountedRenderer = useRef<FencedRendererMount | null>(null);

  useEffect(() => {
    // Effects run after commit, so the ref is attached.
    const el = ref.current as HTMLDivElement;
    return () => el.replaceChildren();
  }, []);

  useEffect(() => {
    const el = ref.current as HTMLDivElement;
    // Another renderer must not draw over this one's output.
    if (mountedRenderer.current !== renderer) el.replaceChildren();
    mountedRenderer.current = renderer;
    const bag = new DisposerBag();
    try {
      renderer.mount(el, { code, openLightbox }, (cleanup) => bag.add(cleanup));
    } catch (err) {
      console.error("A plugin fenced renderer threw in mount():", err);
    }
    return () => bag.dispose();
  }, [renderer, code, openLightbox]);

  return <div ref={ref} />;
}
