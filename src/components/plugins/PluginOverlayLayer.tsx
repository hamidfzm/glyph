import { useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useWindowFullscreen } from "@/hooks/useWindowFullscreen";
import type { OpenOverlay } from "@/lib/plugins/overlays";
import { PluginMountSlot } from "./PluginMountSlot";

/**
 * A plugin overlay over the whole app, with the window fullscreen. Portaled
 * to <body> so no transformed ancestor can trap it inside a pane. The host
 * keeps its own ways out (Escape in `PluginOverlay`, the close button here)
 * so a plugin's bug does not strand the user in a fullscreen layer.
 */
export function PluginOverlayLayer({ overlay }: { overlay: OpenOverlay }) {
  const { t } = useTranslation("common");
  const ref = useRef<HTMLDivElement>(null);
  useWindowFullscreen();

  // A layout effect runs before the plugin's mount (a passive effect in the
  // slot): keys leave the editor underneath, the plugin may then focus its
  // own content, and focus returns where it was on close.
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => previous?.focus();
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
      <PluginMountSlot
        contribution={overlay}
        className="block h-full w-full"
        onError={overlay.close}
      />
      <button
        type="button"
        onClick={overlay.close}
        aria-label={t("lightbox.close")}
        title={t("lightbox.close")}
        className="absolute top-3 end-3 z-20 inline-flex h-8 w-8 items-center justify-center rounded-[var(--glyph-radius-sm)] text-[var(--color-text-secondary)] opacity-50 hover:bg-[var(--color-surface-secondary)] hover:opacity-100 focus-visible:opacity-100"
      >
        <ModalCloseIcon />
      </button>
    </div>,
    document.body,
  );
}
