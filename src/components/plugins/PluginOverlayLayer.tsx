import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useWindowFullscreen } from "@/hooks/useWindowFullscreen";
import type { OpenOverlay } from "@/lib/plugins/overlays";
import { PluginMountSlot } from "./PluginMountSlot";

/**
 * A plugin overlay over the whole app, with the window fullscreen. Portaled
 * to <body> so no transformed ancestor can trap it inside a pane.
 */
export function PluginOverlayLayer({ overlay }: { overlay: OpenOverlay }) {
  const ref = useRef<HTMLDivElement>(null);
  useWindowFullscreen();

  // Capture phase, ahead of the plugin's own key handling: a plugin cannot
  // trap the user in a fullscreen layer.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      overlay.close();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [overlay]);

  // Keys reach the overlay, not a focused editor underneath; focus returns on close.
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.focus();
    return () => {
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label={overlay.label}
      tabIndex={-1}
      data-print-hide="true"
      className="fixed inset-0 z-[200] bg-[var(--color-surface)] outline-none"
    >
      <PluginMountSlot contribution={overlay} className="block h-full w-full" />
    </div>,
    document.body,
  );
}
