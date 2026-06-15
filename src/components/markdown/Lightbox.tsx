import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { ActualSizeIcon } from "@/components/icons/ActualSizeIcon";
import { ChevronLeftIcon } from "@/components/icons/ChevronLeftIcon";
import { ChevronRightIcon } from "@/components/icons/ChevronRightIcon";
import { FitIcon } from "@/components/icons/FitIcon";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { ZoomInIcon } from "@/components/icons/ZoomInIcon";
import { ZoomOutIcon } from "@/components/icons/ZoomOutIcon";
import { clampScale, fitScale, type LightboxImage, ZOOM_STEP } from "@/lib/lightbox";

interface LightboxProps {
  images: LightboxImage[];
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

// Full-screen image viewer: dark backdrop, zoom controls (fit, actual size,
// zoom in/out), and arrow-key navigation between the document's images. The
// image is laid out at `natural × scale` inside a scrollable stage so zooming
// past the viewport pans rather than clips.
export function Lightbox({ images, index, onIndexChange, onClose }: LightboxProps) {
  const image = images[index];
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [isFit, setIsFit] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // Intrinsic pixel size, or null when the image has none (SVGs with only a
  // `viewBox` report naturalWidth/Height === 0). Drives the sizing model below.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const hasMultiple = images.length > 1;

  const computeFit = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img?.naturalWidth) return 1;
    // Subtract the overlay padding so a fitted image clears the toolbar/edges.
    const styles = getComputedStyle(stage);
    const availWidth =
      stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const availHeight =
      stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    return fitScale(img.naturalWidth, img.naturalHeight, availWidth, availHeight);
  }, []);

  const applyFit = useCallback(() => {
    setScale(computeFit());
    setIsFit(true);
  }, [computeFit]);

  const zoomBy = useCallback((factor: number) => {
    setScale((s) => clampScale(s * factor));
    setIsFit(false);
  }, []);

  const actualSize = useCallback(() => {
    setScale(1);
    setIsFit(false);
  }, []);

  const goTo = useCallback(
    (next: number) => {
      if (next < 0 || next >= images.length) return;
      setLoaded(false);
      setNatural(null);
      onIndexChange(next);
    },
    [images.length, onIndexChange],
  );

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    setLoaded(true);
    // SVGs with only a viewBox report no intrinsic pixel size; fall back to a
    // contained layout (see `imageStyle`) so they still display and zoom.
    setNatural(
      img && img.naturalWidth > 0 && img.naturalHeight > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : null,
    );
    applyFit();
  }, [applyFit]);

  // Keyboard controls: close, navigate, and zoom.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowLeft":
          if (hasMultiple) {
            e.preventDefault();
            goTo(index - 1);
          }
          break;
        case "ArrowRight":
          if (hasMultiple) {
            e.preventDefault();
            goTo(index + 1);
          }
          break;
        case "+":
        case "=":
          e.preventDefault();
          zoomBy(ZOOM_STEP);
          break;
        case "-":
          e.preventDefault();
          zoomBy(1 / ZOOM_STEP);
          break;
        case "0":
          e.preventDefault();
          applyFit();
          break;
        case "1":
          e.preventDefault();
          actualSize();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [hasMultiple, index, goTo, zoomBy, applyFit, actualSize, onClose]);

  // Keep the image fitted when the window resizes, unless the user has zoomed.
  useEffect(() => {
    if (!isFit) return;
    const onResize = () => setScale(computeFit());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [isFit, computeFit]);

  if (!image) return null;

  // With an intrinsic size we lay the image out at `natural × scale` so zooming
  // past the viewport pans. Without one (SVG), contain it in `scale × 100%` of
  // the stage so it stays visible and still grows on zoom.
  const imageStyle: CSSProperties = natural
    ? { width: natural.w * scale, opacity: loaded ? 1 : 0 }
    : {
        maxWidth: `${scale * 100}%`,
        maxHeight: `${scale * 100}%`,
        opacity: loaded ? 1 : 0,
      };

  // The dialog is the scroll container and the backdrop: clicking it directly
  // (i.e. the empty area around the image) closes. The controls below are
  // `position: fixed`, so they stay pinned while a zoomed image scrolls.
  return (
    <div
      ref={stageRef}
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt ? `Image: ${image.alt}` : "Image viewer"}
      data-print-hide="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onClose();
        }
      }}
    >
      <button
        type="button"
        className="lightbox-button lightbox-close"
        onClick={onClose}
        aria-label="Close (Esc)"
        title="Close (Esc)"
      >
        <ModalCloseIcon />
      </button>

      {hasMultiple && (
        <button
          type="button"
          className="lightbox-button lightbox-nav lightbox-prev"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label="Previous image (←)"
          title="Previous image (←)"
        >
          <ChevronLeftIcon className="w-5 h-5" />
        </button>
      )}

      <img
        ref={imgRef}
        src={image.src}
        alt={image.alt}
        className="lightbox-image"
        style={imageStyle}
        onLoad={handleLoad}
        draggable={false}
      />

      {hasMultiple && (
        <button
          type="button"
          className="lightbox-button lightbox-nav lightbox-next"
          onClick={() => goTo(index + 1)}
          disabled={index === images.length - 1}
          aria-label="Next image (→)"
          title="Next image (→)"
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      )}

      <div className="lightbox-toolbar">
        <button
          type="button"
          className="lightbox-button"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label="Zoom out (-)"
          title="Zoom out (-)"
        >
          <ZoomOutIcon />
        </button>
        <span className="lightbox-zoom-level" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="lightbox-button"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label="Zoom in (+)"
          title="Zoom in (+)"
        >
          <ZoomInIcon />
        </button>
        <span className="lightbox-toolbar-divider" aria-hidden="true" />
        <button
          type="button"
          className="lightbox-button"
          onClick={applyFit}
          aria-label="Fit to screen (0)"
          title="Fit to screen (0)"
        >
          <FitIcon />
        </button>
        <button
          type="button"
          className="lightbox-button"
          onClick={actualSize}
          aria-label="Actual size (1)"
          title="Actual size (1)"
        >
          <ActualSizeIcon />
        </button>
        {hasMultiple && (
          <>
            <span className="lightbox-toolbar-divider" aria-hidden="true" />
            <span className="lightbox-counter">
              {index + 1} / {images.length}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
