import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import { canvasColorToCss } from "@/lib/canvas/color";
import type { CanvasNode, NodeSide } from "@/lib/canvas/types";
import { CanvasNodeView } from "./CanvasNodeView";

const SIDES: readonly NodeSide[] = ["top", "right", "bottom", "left"];

interface CanvasEditableNodeProps {
  node: CanvasNode;
  canvasPath?: string;
  selected: boolean;
  editing: boolean;
  onSelect: (e: ReactPointerEvent) => void;
  onMoveStart: (e: ReactPointerEvent) => void;
  onResizeStart: (e: ReactPointerEvent) => void;
  onConnectStart: (side: NodeSide, e: ReactPointerEvent) => void;
  onStartEdit: () => void;
  onTextCommit: (value: string) => void;
  onEditCancel: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

/** The inline-editable value for a node: markdown body, group label, or URL. */
function editValue(node: CanvasNode): string {
  switch (node.type) {
    case "text":
      return node.text;
    case "group":
      return node.label ?? "";
    case "link":
      return node.url;
    /* v8 ignore start -- defensive: file nodes are not editable, so this is never read */
    default:
      return "";
    /* v8 ignore stop */
  }
}

/** Placeholder hinting what the inline editor expects, per node type. */
function editPlaceholder(node: CanvasNode): string {
  switch (node.type) {
    case "group":
      return "Group name";
    case "link":
      return "https://example.com";
    default:
      return "Type markdown…";
  }
}

// A node in edit mode: the read-only content plus selection chrome, a
// bottom-right resize handle, four side connectors for drawing edges, and an
// inline textarea for editing text bodies, group labels, and link URLs.
// The chrome hangs outside the border, so clipping happens on the inner
// content wrapper, never on the node itself.
export function CanvasEditableNode(props: CanvasEditableNodeProps) {
  const { node, canvasPath, selected, editing } = props;
  const editable = node.type !== "file";
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
  }, [editing]);

  const commit = () =>
    props.onTextCommit(
      // v8 ignore next -- defensive: textarea ref is always set while editing
      textRef.current?.value ?? "",
    );
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") props.onEditCancel();
    // ⌘/Ctrl+Enter commits multi-line text; for single-line values (group
    // label, link URL) plain Enter commits too.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey || node.type !== "text")) {
      e.preventDefault();
      commit();
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a canvas card is a custom spatial surface — selection/move via pointer, double-click to edit; keyboard editing is reached via the selection and inline textarea
    <div
      className="glyph-canvas-node"
      data-type={node.type}
      data-selected={selected || undefined}
      style={{
        left: node.x,
        top: node.y,
        width: node.width,
        height: node.height,
        borderColor: canvasColorToCss(node.color),
      }}
      onPointerDown={(e) => {
        e.stopPropagation();
        props.onSelect(e);
        if (!editing) props.onMoveStart(e);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (editable) props.onStartEdit();
      }}
      onContextMenu={props.onContextMenu}
    >
      <div className="glyph-canvas-node-content">
        {editing && editable ? (
          <textarea
            ref={textRef}
            className="glyph-canvas-node-editor"
            defaultValue={editValue(node)}
            placeholder={editPlaceholder(node)}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <CanvasNodeView node={node} canvasPath={canvasPath} interactive={false} />
        )}
      </div>

      {selected && !editing && (
        <>
          {SIDES.map((side) => (
            <span
              key={side}
              className="glyph-canvas-connector"
              data-side={side}
              onPointerDown={(e) => {
                e.stopPropagation();
                props.onConnectStart(side, e);
              }}
            />
          ))}
          <span
            className="glyph-canvas-resize"
            onPointerDown={(e) => {
              e.stopPropagation();
              props.onResizeStart(e);
            }}
          />
        </>
      )}
    </div>
  );
}
