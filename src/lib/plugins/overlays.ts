import type { Disposer } from "./disposer";
import { createRegistry } from "./registry";
import type { OverlayContribution } from "./types";

export interface OpenOverlay extends OverlayContribution {
  /** Removes the overlay; the host calls it on Escape. */
  close: Disposer;
}

/** The open plugin overlay: at most one entry. */
export const overlays = createRegistry<OpenOverlay>();

/** Close any open overlay, whose plugin's cleanups run as it unmounts; true when one was open. */
export function closeOverlays(): boolean {
  const open = overlays.list();
  for (const overlay of open) overlay.close();
  return open.length > 0;
}

/** Show `overlay` in place of any open one; the disposer removes it. */
export function showOverlay(overlay: OpenOverlay): Disposer {
  closeOverlays();
  return overlays.register(overlay);
}
