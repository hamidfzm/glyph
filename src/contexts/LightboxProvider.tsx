import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Lightbox } from "@/components/markdown/Lightbox";
import type { LightboxImage } from "@/lib/lightbox";
import { LightboxContext, type LightboxContextValue } from "./LightboxContext";

interface LightboxState {
  images: LightboxImage[];
  index: number;
}

// Provides click-to-zoom for the images inside its subtree and renders the
// lightbox overlay when one is open. Navigation is scoped to the images within
// the same rendered document (`.markdown-body`), so the arrow keys cycle
// through the document's images in source order.
export function LightboxProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LightboxState | null>(null);

  const open = useCallback((img: HTMLImageElement) => {
    const scope = img.closest(".markdown-body") ?? document;
    const imgs = Array.from(scope.querySelectorAll("img"));
    const index = imgs.indexOf(img);
    if (index < 0) return;
    // `el.src` is the webview-resolved URL (markdown images have no srcset).
    const images = imgs.map((el) => ({ src: el.src, alt: el.alt }));
    setState({ images, index });
  }, []);

  const openSrc = useCallback((src: string, alt = "") => {
    setState({ images: [{ src, alt }], index: 0 });
  }, []);

  const close = useCallback(() => setState(null), []);
  const setIndex = useCallback(
    // setIndex is only wired to the open lightbox, so the state is non-null here.
    (next: number) => setState((s) => ({ ...s!, index: next })),
    [],
  );

  const value = useMemo<LightboxContextValue>(() => ({ open, openSrc }), [open, openSrc]);

  return (
    <LightboxContext.Provider value={value}>
      {children}
      {state && (
        <Lightbox
          images={state.images}
          index={state.index}
          onIndexChange={setIndex}
          onClose={close}
        />
      )}
    </LightboxContext.Provider>
  );
}
