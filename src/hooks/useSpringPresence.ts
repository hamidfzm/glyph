import { useCallback, useEffect, useRef, useState } from "react";
import { createSpringAnimation, type SpringAnimation } from "@/lib/spring";

/**
 * Mount/unmount presence driven by a spring. The hook writes `--presence`
 * (0 closed, 1 open) on the bound element every frame and the surface's CSS
 * maps it onto transform/opacity, so all motion stays compositor-friendly.
 * Closing keeps the node mounted but `inert` (no pointer, focus, keyboard, or
 * AT exposure) until the spring settles; reopening mid-close retargets
 * from the current value, so the surface reverses without a jump. Under
 * reduced motion the spring snaps, so open/close become instant.
 */
export function useSpringPresence(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const elRef = useRef<HTMLElement | null>(null);
  const springRef = useRef<SpringAnimation | null>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const ref = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    if (!el) return;
    springRef.current ??= createSpringAnimation({
      initial: 0,
      onFrame: (value) => {
        elRef.current?.style.setProperty("--presence", String(value));
      },
      onSettle: (target) => {
        if (target === 0 && !openRef.current) setMounted(false);
      },
    });
    // Style the element before its first paint so an opening surface starts
    // hidden instead of flashing fully visible for one frame.
    el.style.setProperty("--presence", String(springRef.current.value()));
    el.toggleAttribute("inert", !openRef.current);
  }, []);

  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  useEffect(() => {
    if (!mounted) return;
    elRef.current?.toggleAttribute("inert", !open);
    springRef.current?.animateTo(open ? 1 : 0);
  }, [open, mounted]);

  useEffect(() => () => springRef.current?.stop(), []);

  return { mounted, ref };
}
