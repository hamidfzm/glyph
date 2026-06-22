import {
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
} from "react";
import { useTranslation } from "react-i18next";
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
  onTaskToggle: (line: number) => void;
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

/** i18n key for the inline-editor placeholder, per node type. */
function editPlaceholderKey(node: CanvasNode): string {
  switch (node.type) {
    case "group":
      return "canvasNode.groupPlaceholder";
    case "link":
      return "canvasNode.linkPlaceholder";
    default:
      return "canvasNode.textPlaceholder";
  }
}

// A node in edit mode: the read-only content plus selection chrome, a
// bottom-right resize handle, four side connectors for drawing edges, and an
// inline textarea for editing text bodies, group labels, and link URLs.
// The chrome hangs outside the border, so clipping happens on the inner
// content wrapper, never on the node itself.
export function CanvasEditableNode(props: CanvasEditableNodeProps) {
  const { t } = useTranslation("common");
  const { node, canvasPath, selected, editing } = props;
  const editable = node.type !== "file";
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  // Latest typed value, tracked outside the DOM. Editing can end without a
  // blur event (clicking the stage clears editingId and React unmounts the
  // textarea; removed elements never fire blur), so the commit-on-end path
  // below must not depend on reading the element.
  const valueRef = useRef("");
  const done = useRef(false);

  useEffect(() => {
    if (editing && textRef.current) {
      valueRef.current = textRef.current.value;
      done.current = false;
      textRef.current.focus();
      textRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    props.onTextCommit(valueRef.current);
  };

  // Safety net: when editing ends any way other than blur/Enter/Escape —
  // clicking the background, double-clicking another card, switching the tab
  // to view mode — commit the pending value instead of silently dropping it.
  // The cleanup commit is deferred one microtask and cancelled if the effect
  // re-runs: under StrictMode a card created in edit mode mounts, cleans up,
  // and mounts again, so an immediate cleanup commit would end the edit (and
  // commit an empty card) the moment it started.
  const onTextCommitRef = useRef(props.onTextCommit);
  onTextCommitRef.current = props.onTextCommit;
  const pendingCommit = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => {
    if (!editing) return;
    if (pendingCommit.current) pendingCommit.current.cancelled = true;
    return () => {
      const token = { cancelled: false };
      pendingCommit.current = token;
      queueMicrotask(() => {
        if (!token.cancelled && !done.current) {
          done.current = true;
          onTextCommitRef.current(valueRef.current);
        }
      });
    };
  }, [editing]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      // Discard: mark the edit finished so the end-of-editing commit skips.
      done.current = true;
      props.onEditCancel();
    }
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
            placeholder={t(editPlaceholderKey(node))}
            onChange={(e) => {
              valueRef.current = e.target.value;
            }}
            onPointerDown={(e) => e.stopPropagation()}
            onBlur={commit}
            onKeyDown={onKeyDown}
          />
        ) : (
          <CanvasNodeView
            node={node}
            canvasPath={canvasPath}
            interactive={false}
            onTaskToggle={props.onTaskToggle}
          />
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
