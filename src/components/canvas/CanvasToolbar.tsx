// The board's floating bottom-right toolbar: zoom controls plus, in the
// editor, the node-creation buttons. Shared by the viewer and the editor.

interface CanvasToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Editor only — when set, the creation buttons render. */
  onAdd?: (type: "text" | "group" | "link") => void;
}

export function CanvasToolbar({ zoom, onZoomIn, onZoomOut, onFit, onAdd }: CanvasToolbarProps) {
  return (
    <div className="glyph-canvas-toolbar">
      {onAdd && (
        <>
          <button type="button" onClick={() => onAdd("text")} aria-label="Add card">
            + Card
          </button>
          <button type="button" onClick={() => onAdd("group")} aria-label="Add group">
            + Group
          </button>
          <button type="button" onClick={() => onAdd("link")} aria-label="Add link">
            + Link
          </button>
          <span className="glyph-canvas-toolbar-sep" />
        </>
      )}
      <button type="button" onClick={onZoomOut} aria-label="Zoom out">
        −
      </button>
      <span className="glyph-canvas-zoom-level">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn} aria-label="Zoom in">
        +
      </button>
      <button type="button" onClick={onFit} aria-label="Fit to content">
        Fit
      </button>
    </div>
  );
}
