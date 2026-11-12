import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Lightbox } from "@/components/markdown/Lightbox";
import type { LightboxItem } from "@/lib/lightbox";
import { LightboxContext, type LightboxContextValue } from "./LightboxContext";

interface LightboxState {
  items: LightboxItem[];
  index: number;
  /** Counts opens, so each one starts a fresh lightbox at actual size. */
  id: number;
}

// Provides click-to-zoom for the images inside its subtree, and the expand
// button for its tables, and renders the lightbox overlay when one is open.
// Navigation is scoped to the images within the same rendered document
// (`.markdown-body`), so the arrow keys cycle through the document's images in
// source order.
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openCountRef = useRef(0);

  const open = useCallback((img: HTMLImageElement) => {
    const scope = img.closest(".markdown-body") ?? document;
    const imgs = Array.from(scope.querySelectorAll("img"));
    const index = imgs.indexOf(img);
    if (index < 0) return;
    // `el.src` is the webview-resolved URL (markdown images have no srcset).
    const items = imgs.map((el) => ({ kind: "image" as const, src: el.src, alt: el.alt }));
    setState({ items, index, id: ++openCountRef.current });
  }, []);

  const openSrc = useCallback((src: string, alt = "") => {
    setState({ items: [{ kind: "image", src, alt }], index: 0, id: ++openCountRef.current });
  }, []);

  const openTable = useCallback((content: ReactNode, trigger: HTMLElement) => {
    returnFocusRef.current = trigger;
    // The document body resolves its direction with dir="auto"; the portal can't inherit it.
    const dir = getComputedStyle(trigger).direction;
    setState({ items: [{ kind: "table", content, dir }], index: 0, id: ++openCountRef.current });
  }, []);

  const close = useCallback(() => {
    setState(null);
    // No scroll: a link followed out of the table has just scrolled the document.
    returnFocusRef.current?.focus({ preventScroll: true });
    returnFocusRef.current = null;
  }, []);
  const setIndex = useCallback(
    // setIndex is only wired to the open lightbox, so the state is non-null here.
    (next: number) => setState((s) => ({ ...s!, index: next })),
    [],
  );

  const value = useMemo<LightboxContextValue>(
    () => ({ open, openSrc, openTable }),
    [open, openSrc, openTable],
  );

  return (
    <LightboxContext.Provider value={value}>
      {children}
      {state && (
        <Lightbox
          key={state.id}
          items={state.items}
          index={state.index}
          onIndexChange={setIndex}
          onClose={close}
        />
      )}
    </LightboxContext.Provider>
  );
}
