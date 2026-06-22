import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { canvasColorToCss, PRESET_COLORS } from "@/lib/canvas/color";

interface CanvasSelectionToolbarProps {
  count: number;
  onSetColor: (color: string | undefined) => void;
  onDelete: () => void;
}

// Floating actions for the current selection: recolour (preset swatches, a
// custom colour picker, and a "clear" chip) and delete. Shown only while one
// or more nodes are selected.
export function CanvasSelectionToolbar({
  count,
  onSetColor,
  onDelete,
}: CanvasSelectionToolbarProps) {
  const { t } = useTranslation("common");
  const customRef = useRef<HTMLInputElement | null>(null);
  const onSetColorRef = useRef(onSetColor);
  onSetColorRef.current = onSetColor;

  // Commit the custom colour on the native `change` event, which fires once
  // when the colour dialog is confirmed. React's onChange mirrors `input`,
  // which streams while dragging inside the picker and would flood the undo
  // history with an entry per tick.
  useEffect(() => {
    const input = customRef.current;
    /* v8 ignore start -- defensive: the input is always rendered with the toolbar */
    if (!input) return;
    /* v8 ignore stop */
    const commit = () => onSetColorRef.current(input.value);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, []);

  return (
    <div
      className="glyph-canvas-selection-toolbar"
      role="toolbar"
      aria-label={t("canvasSelection.toolbar")}
    >
      <button
        type="button"
        className="glyph-canvas-swatch"
        data-clear
        aria-label={t("canvasSelection.clearColor")}
        onClick={() => onSetColor(undefined)}
      />
      {PRESET_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className="glyph-canvas-swatch"
          style={{ background: canvasColorToCss(c) }}
          aria-label={t("canvasSelection.colorLabel", { color: c })}
          onClick={() => onSetColor(c)}
        />
      ))}
      <input
        ref={customRef}
        type="color"
        className="glyph-canvas-swatch"
        data-custom
        aria-label={t("canvasSelection.customColor")}
        defaultValue="#a882ff"
      />
      <button type="button" className="glyph-canvas-delete" onClick={onDelete}>
        {count > 1 ? t("canvasSelection.deleteCount", { count }) : t("canvasSelection.delete")}
      </button>
    </div>
  );
}
