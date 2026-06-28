import { createContext, useContext } from "react";

// Context + hook for the image lightbox. Kept in a component-free module so the
// provider file stays Fast-Refresh-eligible (a file that exports a component
// plus a hook/context bails out of React Fast Refresh). The provider lives in
// `LightboxProvider.tsx`.

export interface LightboxContextValue {
  /** Open the lightbox, starting at the clicked image. */
  open: (img: HTMLImageElement) => void;
}

export const LightboxContext = createContext<LightboxContextValue | null>(null);

/** Returns the lightbox API, or null when rendered outside a provider. */
export function useLightbox(): LightboxContextValue | null {
  return useContext(LightboxContext);
}
