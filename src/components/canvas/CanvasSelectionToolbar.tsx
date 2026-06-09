import { canvasColorToCss, PRESET_COLORS } from "@/lib/canvas/color";

interface CanvasSelectionToolbarProps {
  count: number;
  onSetColor: (color: string | undefined) => void;
  onDelete: () => void;
}

// Floating actions for the current selection: recolour (preset swatches + a
// "clear" chip) and delete. Shown only while one or more nodes are selected.
export function CanvasSelectionToolbar({
  count,
  onSetColor,
  onDelete,
}: CanvasSelectionToolbarProps) {
  return (
    <div className="glyph-canvas-selection-toolbar" role="toolbar" aria-label="Selection">
      <button
        type="button"
        className="glyph-canvas-swatch"
        data-clear
        aria-label="Clear colour"
        onClick={() => onSetColor(undefined)}
      />
      {PRESET_COLORS.map((c) => (
        <button
          type="button"
          key={c}
          className="glyph-canvas-swatch"
          style={{ background: canvasColorToCss(c) }}
          aria-label={`Colour ${c}`}
          onClick={() => onSetColor(c)}
        />
      ))}
      <button type="button" className="glyph-canvas-delete" onClick={onDelete}>
        Delete{count > 1 ? ` (${count})` : ""}
      </button>
    </div>
  );
}
