// The board's floating bottom-right toolbar: zoom controls plus, in the
// editor, the node-creation buttons. Shared by the viewer and the editor.

import { useTranslation } from "react-i18next";

interface CanvasToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Editor only — when set, the creation buttons render. */
  onAdd?: (type: "text" | "group" | "link") => void;
}

export function CanvasToolbar({ zoom, onZoomIn, onZoomOut, onFit, onAdd }: CanvasToolbarProps) {
  const { t } = useTranslation("common");
  return (
    <div className="glyph-canvas-toolbar">
      {onAdd && (
        <>
          <button
            type="button"
            onClick={() => onAdd("text")}
            aria-label={t("canvasToolbar.addCard")}
          >
            {t("canvasToolbar.addCardLabel")}
          </button>
          <button
            type="button"
            onClick={() => onAdd("group")}
            aria-label={t("canvasToolbar.addGroup")}
          >
            {t("canvasToolbar.addGroupLabel")}
          </button>
          <button
            type="button"
            onClick={() => onAdd("link")}
            aria-label={t("canvasToolbar.addLink")}
          >
            {t("canvasToolbar.addLinkLabel")}
          </button>
          <span className="glyph-canvas-toolbar-sep" />
        </>
      )}
      <button type="button" onClick={onZoomOut} aria-label={t("canvasToolbar.zoomOut")}>
        −
      </button>
      <span className="glyph-canvas-zoom-level">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn} aria-label={t("canvasToolbar.zoomIn")}>
        +
      </button>
      <button type="button" onClick={onFit} aria-label={t("canvasToolbar.fit")}>
        {t("canvasToolbar.fitLabel")}
      </button>
    </div>
  );
}
