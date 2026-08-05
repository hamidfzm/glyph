import { useEffect } from "react";
import { ZOOM_STEP } from "@/lib/lightbox";

interface UseLightboxKeysOptions {
  /** False for a single-image document, which disables the arrow keys. */
  hasMultiple: boolean;
  index: number;
  onGoTo: (index: number) => void;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onActualSize: () => void;
  onClose: () => void;
}

/** Keyboard controls for the lightbox: close, navigate, and zoom. */
export function useLightboxKeys({
  hasMultiple,
  index,
  onGoTo,
  onZoomBy,
  onFit,
  onActualSize,
  onClose,
}: UseLightboxKeysOptions): void {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowLeft":
          if (hasMultiple) {
            e.preventDefault();
            onGoTo(index - 1);
          }
          break;
        case "ArrowRight":
          if (hasMultiple) {
            e.preventDefault();
            onGoTo(index + 1);
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          onZoomBy(ZOOM_STEP);
          break;
        case "-":
          e.preventDefault();
          onZoomBy(1 / ZOOM_STEP);
          break;
        case "0":
          e.preventDefault();
          onFit();
          break;
        case "1":
          e.preventDefault();
          onActualSize();
          break;
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hasMultiple, index, onGoTo, onZoomBy, onFit, onActualSize, onClose]);
}
