import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";
import { Lightbox } from "@/components/markdown/Lightbox";
import type { LightboxImage } from "@/lib/lightbox";

interface LightboxContextValue {
  /** Open the lightbox, starting at the clicked image. */
  open: (img: HTMLImageElement) => void;
}

const LightboxContext = createContext<LightboxContextValue | null>(null);

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
    const images = imgs.map((el) => ({ src: el.currentSrc || el.src, alt: el.alt }));
    setState({ images, index });
  }, []);

  const close = useCallback(() => setState(null), []);
  const setIndex = useCallback(
    (next: number) => setState((s) => (s ? { ...s, index: next } : s)),
    [],
  );

  const value = useMemo<LightboxContextValue>(() => ({ open }), [open]);

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

/** Returns the lightbox API, or null when rendered outside a provider. */
export function useLightbox(): LightboxContextValue | null {
  return useContext(LightboxContext);
}
