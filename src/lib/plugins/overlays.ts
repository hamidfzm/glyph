import type { Disposer } from "./disposer";
import { createRegistry } from "./registry";
import type { OverlayContribution } from "./types";

export interface OpenOverlay extends OverlayContribution {
  /** Removes the overlay; the host calls it on Escape. */
  close: Disposer;
}

/** The open plugin overlay: at most one entry. */
export const overlays = createRegistry<OpenOverlay>();

/** Show `overlay` in place of any open one; the disposer removes it. */
export function showOverlay(overlay: OpenOverlay): Disposer {
  for (const open of overlays.list()) open.close();
  return overlays.register(overlay);
}
