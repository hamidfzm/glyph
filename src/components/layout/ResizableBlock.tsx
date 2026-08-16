import { type ReactNode, useCallback, useRef } from "react";
import { usePanelResize } from "@/hooks/usePanelResize";
import { ResizeHandle } from "./ResizeHandle";

// Keep at least this much of the Files panel for the tree when dragging a
// block divider up.
const TREE_RESERVE = 120;

interface ResizableBlockProps {
  label: string;
  min: number;
  /** Persisted height; null keeps the block at its natural height. */
  height: number | null;
  onHeightCommit: (height: number | null) => void;
  /** Cap for the natural height, applied only while no height is persisted. */
  naturalMax?: number;
  /** A collapsed block is only its heading, so it isn't resizable. */
  collapsed?: boolean;
  children: ReactNode;
}

/** A block pinned below the Files panel tree, with the drag divider that
 *  resizes it against the tree above. */
export function ResizableBlock({
  label,
  min,
  height,
  onHeightCommit,
  naturalMax,
  collapsed = false,
  children,
}: ResizableBlockProps) {
  const blockRef = useRef<HTMLDivElement>(null);

  const maxHeight = useCallback(
    () => Math.max(min, (blockRef.current?.parentElement?.clientHeight ?? 0) - TREE_RESERVE),
    [min],
  );
  // The idle height is DOM-measured so a drag starts from the rendered height
  // even when the block is auto-sized; it is also the idle aria value, and on
  // the first render the ref is not attached yet, so the minimum stands in.
  const measure = useCallback(() => blockRef.current?.offsetHeight ?? min, [min]);
  const resize = usePanelResize({
    size: measure,
    min,
    max: maxHeight,
    axis: "y",
    // The block sits below the tree: dragging the divider up grows it.
    direction: -1,
    onCommit: onHeightCommit,
    onReset: () => onHeightCommit(null),
  });
  const size = resize.size ?? height;

  return (
    <>
      {collapsed ? (
        <div className="mt-3 h-1.5 shrink-0" />
      ) : (
        <ResizeHandle
          axis="y"
          label={label}
          value={size ?? measure()}
          min={min}
          max={maxHeight()}
          className="mt-3 -mx-3 h-1.5 shrink-0"
          {...resize.handleProps}
        />
      )}
      <div
        ref={blockRef}
        className="pt-2 border-t border-[var(--color-border)] shrink-0 overflow-y-auto"
        style={
          collapsed
            ? undefined
            : { height: size ?? undefined, maxHeight: size === null ? naturalMax : undefined }
        }
      >
        {children}
      </div>
    </>
  );
}
