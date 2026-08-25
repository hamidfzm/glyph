import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeftIcon } from "@/components/icons/ChevronLeftIcon";
import { ChevronRightIcon } from "@/components/icons/ChevronRightIcon";
import { ModalCloseIcon } from "@/components/icons/ModalCloseIcon";
import { useDragPan } from "@/hooks/useDragPan";
import { useLightboxKeys } from "@/hooks/useLightboxKeys";
import { clampScale, fitScale, type LightboxImage } from "@/lib/lightbox";
import { decodeSvgDataUrl } from "@/lib/svgDataUrl";
import { svgIntrinsicSize } from "@/lib/svgIntrinsicSize";
import { LightboxToolbar } from "./LightboxToolbar";

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
  const { t } = useTranslation("common");
  const image = images[index];
  const imgRef = useRef<HTMLImageElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  useDragPan(stageRef);
  const [scale, setScale] = useState(1);
  const [isFit, setIsFit] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // Intrinsic pixel size, or null when the image has none (SVGs with only a
  // `viewBox` report naturalWidth/Height === 0). Drives the sizing model below.
  // `naturalRef` mirrors it for the fit math, which runs inside the load
  // handler before the state has committed.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);

  const hasMultiple = images.length > 1;

  const computeFit = useCallback(() => {
    const stage = stageRef.current;
    const size = naturalRef.current;
    if (!stage || !size) return 1;
    // Subtract the overlay padding so a fitted image clears the toolbar/edges.
    const styles = getComputedStyle(stage);
    const availWidth =
      stage.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const availHeight =
      stage.clientHeight - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    return fitScale(size.w, size.h, availWidth, availHeight);
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
      naturalRef.current = null;
      onIndexChange(next);
    },
    [images.length, onIndexChange],
  );

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    setLoaded(true);
    // SVGs with only a viewBox report no intrinsic pixel size; recover one from
    // the markup when the source is an SVG data URL (Mermaid/D2 diagrams) so
    // the image still lays out at natural × scale and pans when zoomed. Only a
    // size-less non-data-URL SVG falls back to the contained layout below.
    let size =
      img && img.naturalWidth > 0 && img.naturalHeight > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : null;
    if (!size && image) {
      const svg = decodeSvgDataUrl(image.src);
      size = svg ? svgIntrinsicSize(svg) : null;
    }
    naturalRef.current = size;
    setNatural(size);
    applyFit();
  }, [applyFit, image]);

  useLightboxKeys({
    hasMultiple,
    index,
    onGoTo: goTo,
    onZoomBy: zoomBy,
    onFit: applyFit,
    onActualSize: actualSize,
    onClose,
  });

  // Keep the image fitted when the window resizes, unless the user has zoomed.
  useEffect(() => {
    if (!isFit) return;
    const handleResize = () => setScale(computeFit());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFit, computeFit]);

  if (!image) return null;

  // With an intrinsic size we lay the image out at `natural × scale` so zooming
  // past the viewport pans. Without one (an SVG with only a viewBox) there are
  // no pixels to multiply, so fill the stage with object-fit contain and zoom
  // via transform — max-width alone caps the size but can't enlarge it.
  const imageStyle: CSSProperties = natural
    ? // `natural` is only set together with `loaded` in handleLoad, so it's
      // always loaded by the time this branch renders.
      { width: natural.w * scale, opacity: 1 }
    : {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        transform: `scale(${scale})`,
        opacity: loaded ? 1 : 0,
        // The stretched element owns the letterbox around the visible image;
        // letting clicks through keeps the backdrop's click-to-close working.
        pointerEvents: "none",
      };

  // The dialog is the scroll container and the backdrop: clicking it directly
  // (i.e. the empty area around the image) closes. The controls below are
  // `position: fixed`, so they stay pinned while a zoomed image scrolls.
  // Portaled to <body>: a transformed ancestor (canvas cards render markdown
  // inside the pan/zoom world) would otherwise become the containing block and
  // trap the "full-screen" overlay inside the pane.
  return createPortal(
    <div
      ref={stageRef}
      className="lightbox-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={image.alt ? t("lightbox.image", { alt: image.alt }) : t("lightbox.viewer")}
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
        aria-label={t("lightbox.close")}
        title={t("lightbox.close")}
      >
        <ModalCloseIcon />
      </button>

      {hasMultiple && (
        <button
          type="button"
          className="lightbox-button lightbox-nav lightbox-prev"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
          aria-label={t("lightbox.previous")}
          title={t("lightbox.previous")}
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
          aria-label={t("lightbox.next")}
          title={t("lightbox.next")}
        >
          <ChevronRightIcon className="w-5 h-5" />
        </button>
      )}

      <LightboxToolbar
        scale={scale}
        index={index}
        total={images.length}
        onZoomBy={zoomBy}
        onFit={applyFit}
        onActualSize={actualSize}
      />
    </div>,
    document.body,
  );
}
