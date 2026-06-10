import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import type { Point } from "@/lib/canvas/geometry";

interface CanvasEdgeLabelEditorProps {
  /** World-space midpoint of the edge; the input centres itself on it. */
  at: Point;
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

// Inline editor for an edge's label, floated over the edge midpoint. Same
// commit-on-end contract as the card editor: Enter and blur commit eagerly, a
// cleanup effect catches every other way editing can end (clicking the stage,
// switching modes), and Escape marks the edit discarded.
export function CanvasEdgeLabelEditor({
  at,
  initial,
  onCommit,
  onCancel,
}: CanvasEdgeLabelEditorProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(initial);
  const done = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      if (!done.current) {
        done.current = true;
        onCommitRef.current(valueRef.current);
      }
    };
  }, []);

  const commit = () => {
    if (done.current) return;
    done.current = true;
    onCommit(valueRef.current);
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === "Escape") {
      done.current = true;
      onCancel();
    }
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  };

  return (
    <input
      ref={inputRef}
      className="glyph-canvas-edge-label-editor"
      style={{ left: at.x, top: at.y }}
      defaultValue={initial}
      placeholder="Label"
      aria-label="Edge label"
      onChange={(e) => {
        valueRef.current = e.target.value;
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
