import { FolderIcon } from "../icons/FolderIcon";
import { OutlineIcon } from "../icons/OutlineIcon";

interface EdgeExpandProps {
  side: "left" | "right";
  onClick: () => void;
  title: string;
  // Glyph for the panel that's hidden — folder icon for Files, outline icon
  // for Outline. More meaningful than a generic chevron.
  panel: "files" | "outline";
}

// Vertical strip on the screen edge, shown when a sidebar panel is hidden but
// its content is available. Shows the panel's own icon so it reads as
// "click to bring back the [folder/outline] panel".
export function EdgeExpand({ side, onClick, title, panel }: EdgeExpandProps) {
  const borderClass = side === "left" ? "border-r" : "border-l";
  const Icon = panel === "files" ? FolderIcon : OutlineIcon;
  return (
    <button
      type="button"
      data-print-hide="true"
      data-sidebar-edge={side}
      data-sidebar-edge-panel={panel}
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`shrink-0 w-7 flex items-center justify-center ${borderClass} border-[var(--color-border)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-tertiary)] transition-colors cursor-pointer`}
      style={{ background: "var(--color-surface-secondary)" }}
    >
      <Icon />
    </button>
  );
}
