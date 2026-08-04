import { useTranslation } from "react-i18next";
import { ActualSizeIcon } from "@/components/icons/ActualSizeIcon";
import { FitIcon } from "@/components/icons/FitIcon";
import { ZoomInIcon } from "@/components/icons/ZoomInIcon";
import { ZoomOutIcon } from "@/components/icons/ZoomOutIcon";
import { ZOOM_STEP } from "@/lib/lightbox";

interface ImageViewerToolbarProps {
  scale: number;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onActualSize: () => void;
}

/** Zoom controls docked under the image stage. */
export function ImageViewerToolbar({
  scale,
  onZoomBy,
  onFit,
  onActualSize,
}: ImageViewerToolbarProps) {
  const { t } = useTranslation("common");

  return (
    <div className="image-viewer-toolbar">
      <button
        type="button"
        className="image-viewer-btn"
        onClick={() => onZoomBy(1 / ZOOM_STEP)}
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
        onClick={() => onZoomBy(ZOOM_STEP)}
        aria-label={t("lightbox.zoomIn")}
        title={t("lightbox.zoomIn")}
      >
        <ZoomInIcon />
      </button>
      <span className="image-viewer-divider" aria-hidden="true" />
      <button
        type="button"
        className="image-viewer-btn"
        onClick={onFit}
        aria-label={t("lightbox.fit")}
        title={t("lightbox.fit")}
      >
        <FitIcon />
      </button>
      <button
        type="button"
        className="image-viewer-btn"
        onClick={onActualSize}
        aria-label={t("lightbox.actualSize")}
        title={t("lightbox.actualSize")}
      >
        <ActualSizeIcon />
      </button>
    </div>
  );
}
