import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("common");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const valueRef = useRef(initial);
  const done = useRef(false);
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;

  // The cleanup commit is deferred one microtask and cancelled if the effect
  // re-runs: under StrictMode the mount effect is invoked, cleaned up, and
  // invoked again, so an immediate cleanup commit would close the editor the
  // moment it opened. Only a real unmount leaves the scheduled commit alive.
  const pendingCommit = useRef<{ cancelled: boolean } | null>(null);
  useEffect(() => {
    if (pendingCommit.current) pendingCommit.current.cancelled = true;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      const token = { cancelled: false };
      pendingCommit.current = token;
      queueMicrotask(() => {
        if (!token.cancelled && !done.current) {
          done.current = true;
          onCommitRef.current(valueRef.current);
        }
      });
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
      placeholder={t("canvasEdge.labelPlaceholder")}
      aria-label={t("canvasEdge.labelAria")}
      onChange={(e) => {
        valueRef.current = e.target.value;
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={commit}
      onKeyDown={onKeyDown}
    />
  );
}
