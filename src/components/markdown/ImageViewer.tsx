import { invoke } from "@tauri-apps/api/core";
import { type CSSProperties, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActualSizeIcon } from "@/components/icons/ActualSizeIcon";
import { FitIcon } from "@/components/icons/FitIcon";
import { ZoomInIcon } from "@/components/icons/ZoomInIcon";
import { ZoomOutIcon } from "@/components/icons/ZoomOutIcon";
import { useDragPan } from "@/hooks/useDragPan";
import { isSvgFile } from "@/lib/imageExtensions";
import { clampScale, fitScale, ZOOM_STEP } from "@/lib/lightbox";
import { svgToDataUrl } from "@/lib/svgDataUrl";
import { toAssetUrl } from "./resolveImageSrc";

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
  const [scale, setScale] = useState(1);
  const [isFit, setIsFit] = useState(true);
  const [loaded, setLoaded] = useState(false);
  // Intrinsic pixel size, or null when the image has none (SVGs with only a
  // `viewBox` report naturalWidth/Height === 0). Drives the sizing model below.
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // SVGs render from their inlined markup as a `data:` URL rather than the asset
  // protocol: it always loads (no protocol round-trip that can come back empty)
  // and the markup is cheap to read. Raster assets keep the asset protocol. The
  // initial null src means the <img> stays empty for one tick until the read
  // resolves, then `onLoad` measures it.
  const [src, setSrc] = useState<string | null>(isSvgFile(filePath) ? null : toAssetUrl(filePath));

  useEffect(() => {
    if (!isSvgFile(filePath)) {
      setSrc(toAssetUrl(filePath));
      return;
    }
    let cancelled = false;
    invoke<string>("read_file", { path: filePath })
      .then((svg) => {
        if (!cancelled) setSrc(svgToDataUrl(svg));
      })
      // Fall back to the asset protocol if the read fails for any reason.
      .catch(() => {
        if (!cancelled) setSrc(toAssetUrl(filePath));
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  const computeFit = useCallback(() => {
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img?.naturalWidth) return 1;
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

  const handleLoad = useCallback(() => {
    const img = imgRef.current;
    setLoaded(true);
    setNatural(
      img && img.naturalWidth > 0 && img.naturalHeight > 0
        ? { w: img.naturalWidth, h: img.naturalHeight }
        : null,
    );
    applyFit();
  }, [applyFit]);

  // Keep a fitted image fitted on resize, unless the user has zoomed.
  useEffect(() => {
    if (!isFit) return;
    const handleResize = () => setScale(computeFit());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [isFit, computeFit]);

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
      <div className="image-viewer-toolbar">
        <button
          type="button"
          className="image-viewer-btn"
          onClick={() => zoomBy(1 / ZOOM_STEP)}
          aria-label={t("lightbox.zoomOut")}
          title={t("lightbox.zoomOut")}
        >
          <ZoomOutIcon />
        </button>
        <span className="image-viewer-zoom-level" aria-live="polite">
          {Math.round(scale * 100)}%
        </span>
        <button
          type="button"
          className="image-viewer-btn"
          onClick={() => zoomBy(ZOOM_STEP)}
          aria-label={t("lightbox.zoomIn")}
          title={t("lightbox.zoomIn")}
        >
          <ZoomInIcon />
        </button>
        <span className="image-viewer-divider" aria-hidden="true" />
        <button
          type="button"
          className="image-viewer-btn"
          onClick={applyFit}
          aria-label={t("lightbox.fit")}
          title={t("lightbox.fit")}
        >
          <FitIcon />
        </button>
        <button
          type="button"
          className="image-viewer-btn"
          onClick={actualSize}
          aria-label={t("lightbox.actualSize")}
          title={t("lightbox.actualSize")}
        >
          <ActualSizeIcon />
        </button>
      </div>
    </section>
  );
}
