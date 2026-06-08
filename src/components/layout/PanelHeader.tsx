import { PanelCollapseIcon } from "../icons/PanelCollapseIcon";

interface PanelHeaderProps {
  label: string;
  side: "left" | "right";
  onCollapse: () => void;
  collapseTitle: string;
  // Extra action buttons rendered before the hide-panel button (e.g. the
  // file-explorer toolbar).
  actions?: React.ReactNode;
}

// Title row for a sidebar panel: uppercase label, optional action buttons, and
// a collapse button whose chevron points toward the panel's screen edge.
export function PanelHeader({ label, side, onCollapse, collapseTitle, actions }: PanelHeaderProps) {
  const chevronDirection = side === "left" ? "left" : "right";
  return (
    <div className="flex items-center justify-between gap-2 px-2 mb-2">
      <h3
        className="text-xs font-semibold text-[var(--color-text-tertiary)] uppercase tracking-wider truncate"
        title={label}
      >
        {label}
      </h3>
      <div className="flex items-center gap-0.5 shrink-0">
        {actions}
        <button
          type="button"
          onClick={onCollapse}
          className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] p-0.5 rounded-[var(--glyph-radius-sm)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
          title={collapseTitle}
          aria-label={collapseTitle}
        >
          <PanelCollapseIcon direction={chevronDirection} />
        </button>
      </div>
    </div>
  );
}
