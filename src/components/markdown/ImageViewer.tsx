import { type CSSProperties, useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDragPan } from "@/hooks/useDragPan";
import { useImageSource } from "@/hooks/useImageSource";
import { useImageZoom } from "@/hooks/useImageZoom";
import { ImageViewerToolbar } from "./ImageViewerToolbar";

interface ImageViewerProps {
  filePath: string;
}

// Read-only viewer for an image/SVG file tab. The asset is served through
// Tauri's asset protocol (never read as text), laid out inside a scrollable
// stage so zooming past the viewport pans rather than clips. Zoom math is
// shared with the markdown lightbox (see lib/lightbox.ts).
export function ImageViewer({ filePath }: ImageViewerProps) {
  const { t } = useTranslation("common");
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useDragPan(stageRef);
  const [loaded, setLoaded] = useState(false);
  // Intrinsic pixel size, or null when the image has none. Drives the sizing
  // model below. `naturalRef` mirrors it for the fit math, which runs inside a
  // load handler before the state has committed.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const naturalRef = useRef<{ w: number; h: number } | null>(null);
  const { src, svgSizeRef } = useImageSource(filePath);
  const { scale, applyFit, zoomBy, actualSize } = useImageZoom(stageRef, naturalRef);

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    // Prefer the webview's measured pixels; fall back to an SVG's parsed size
    // (viewBox-only SVGs report naturalWidth/Height === 0). Both give a real
    // layout size so zooming past the viewport pans instead of clipping.
    const size =
      img && img.naturalWidth > 0 && img.naturalHeight > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : svgSizeRef.current;
    naturalRef.current = size;
    setLoaded(true);
    setNatural(size);
    applyFit();
  }, [applyFit, svgSizeRef]);

  // With an intrinsic size we lay the image out at `natural × scale` so zooming
  // past the viewport pans. Without one (an SVG with only a viewBox) there are
  // no pixels to multiply, so contain it in the stage and zoom via transform.
  const imageStyle: CSSProperties = natural
    ? { width: natural.w * scale, opacity: 1 }
    : {
        width: "100%",
        height: "100%",
        objectFit: "contain",
        transform: `scale(${scale})`,
        opacity: loaded ? 1 : 0,
      };

  return (
    <section className="image-viewer" aria-label={t("lightbox.viewer")}>
      <div ref={stageRef} className="image-viewer-stage">
        <img
          ref={imgRef}
          src={src ?? undefined}
          alt=""
          className="image-viewer-img"
          style={imageStyle}
          onLoad={handleLoad}
          draggable={false}
        />
      </div>
      <ImageViewerToolbar
        scale={scale}
        onZoomBy={zoomBy}
        onFit={applyFit}
        onActualSize={actualSize}
      />
    </section>
  );
}
