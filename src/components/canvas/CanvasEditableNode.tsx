import {
  type KeyboardEvent as ReactKeyboardEvent,
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
}

// A node in edit mode: the read-only content plus selection chrome, a
// bottom-right resize handle, four side connectors for drawing edges, and an
// inline textarea for editing text-node bodies / group labels.
export function CanvasEditableNode(props: CanvasEditableNodeProps) {
  const { node, canvasPath, selected, editing } = props;
  const editable = node.type === "text" || node.type === "group";
  const textRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && textRef.current) {
      textRef.current.focus();
      textRef.current.select();
    }
  }, [editing]);

  const commit = () => props.onTextCommit(textRef.current?.value ?? "");
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") props.onEditCancel();
    // ⌘/Ctrl+Enter commits multi-line text without inserting a newline.
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit();
  };

  const initial =
    node.type === "text" ? node.text : node.type === "group" ? (node.label ?? "") : "";

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
    >
      {editing && editable ? (
        <textarea
          ref={textRef}
          className="glyph-canvas-node-editor"
          defaultValue={initial}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={commit}
          onKeyDown={onKeyDown}
        />
      ) : (
        <CanvasNodeView node={node} canvasPath={canvasPath} />
      )}

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
