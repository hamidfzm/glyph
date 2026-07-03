import type { PanelResizeHandleProps } from "@/hooks/usePanelResize";

interface ResizeHandleProps extends PanelResizeHandleProps {
  // "x" resizes a width (col-resize cursor), "y" a height (row-resize).
  axis: "x" | "y";
  // Positioning classes from the caller (e.g. "absolute inset-y-0 end-0").
  className: string;
  label: string;
  // Current/min/max size of the controlled panel, for assistive tech.
  value: number;
  min: number;
  max: number;
}

// Thin drag strip on a panel edge. Drag to resize, arrow keys nudge when
// focused, double-click resets. Invisible until hovered/active so it reads as
// an edge, not a border. An <hr> because its implicit role is separator;
// tabIndex upgrades it to the focusable (resizing) variant, and the preflight
// hr height/border are reset so the caller's classes size the hit area.
export function ResizeHandle({
  axis,
  className,
  label,
  value,
  min,
  max,
  ...handleProps
}: ResizeHandleProps) {
  const cursor = axis === "x" ? "cursor-col-resize h-auto" : "cursor-row-resize";
  return (
    <hr
      tabIndex={0}
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={Math.round(max)}
      className={`border-0 m-0 ${cursor} select-none touch-none z-10 transition-colors hover:bg-[var(--color-accent)]/50 active:bg-[var(--color-accent)] focus-visible:bg-[var(--color-accent)]/50 focus:outline-none ${className}`}
      {...handleProps}
    />
  );
}
