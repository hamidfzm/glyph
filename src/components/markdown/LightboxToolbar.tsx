import { useTranslation } from "react-i18next";
import { ActualSizeIcon } from "@/components/icons/ActualSizeIcon";
import { FitIcon } from "@/components/icons/FitIcon";
import { ZoomInIcon } from "@/components/icons/ZoomInIcon";
import { ZoomOutIcon } from "@/components/icons/ZoomOutIcon";
import { ZOOM_STEP } from "@/lib/lightbox";

interface LightboxToolbarProps {
  scale: number;
  /** Position in the document's image list, for the "3 / 8" counter. */
  index: number;
  total: number;
  onZoomBy: (factor: number) => void;
  onFit: () => void;
  onActualSize: () => void;
}

/** Pinned zoom controls and image counter at the foot of the lightbox. */
export function LightboxToolbar({
  scale,
  index,
  total,
  onZoomBy,
  onFit,
  onActualSize,
}: LightboxToolbarProps) {
  const { t } = useTranslation("common");

  return (
    <div className="lightbox-toolbar">
      <button
        type="button"
        className="lightbox-button"
        onClick={() => onZoomBy(1 / ZOOM_STEP)}
        aria-label={t("lightbox.zoomOut")}
        title={t("lightbox.zoomOut")}
      >
        <ZoomOutIcon />
      </button>
      <span className="lightbox-zoom-level" aria-live="polite">
        {Math.round(scale * 100)}%
      </span>
      <button
        type="button"
        className="lightbox-button"
        onClick={() => onZoomBy(ZOOM_STEP)}
        aria-label={t("lightbox.zoomIn")}
        title={t("lightbox.zoomIn")}
      >
        <ZoomInIcon />
      </button>
      <span className="lightbox-toolbar-divider" aria-hidden="true" />
      <button
        type="button"
        className="lightbox-button"
        onClick={onFit}
        aria-label={t("lightbox.fit")}
        title={t("lightbox.fit")}
      >
        <FitIcon />
      </button>
      <button
        type="button"
        className="lightbox-button"
        onClick={onActualSize}
        aria-label={t("lightbox.actualSize")}
        title={t("lightbox.actualSize")}
      >
        <ActualSizeIcon />
      </button>
      {total > 1 && (
        <>
          <span className="lightbox-toolbar-divider" aria-hidden="true" />
          <span className="lightbox-counter">
            {index + 1} / {total}
          </span>
        </>
      )}
    </div>
  );
}
