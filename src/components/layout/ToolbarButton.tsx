// Small icon button for the sidebar panel header toolbar (new note, new folder,
// collapse/expand all).
export function ToolbarButton({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] p-0.5 rounded-[var(--glyph-radius-sm)] hover:bg-[var(--color-surface-tertiary)] transition-colors"
      title={title}
      aria-label={title}
    >
      {children}
    </button>
  );
}
