// Small icon button for the sidebar panel header toolbar (new note, new folder,
// collapse/expand all, tag sort).
export function ToolbarButton({
  onClick,
  title,
  pressed,
  children,
}: {
  onClick: () => void;
  title: string;
  /** Set to make the button a toggle, which also exposes its on/off state. */
  pressed?: boolean;
  children: React.ReactNode;
}) {
  const tone = pressed
    ? "text-[var(--color-text-primary)] bg-[var(--color-surface-tertiary)]"
    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`pressable p-0.5 rounded-[var(--glyph-radius-sm)] hover:bg-[var(--color-surface-tertiary)] transition-colors ${tone}`}
      title={title}
      aria-label={title}
      aria-pressed={pressed}
    >
      {children}
    </button>
  );
}
