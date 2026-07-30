interface ActionBarButtonProps {
  onClick: () => void;
  /** Accessible name. Also the tooltip unless `title` overrides it. */
  label: string;
  title?: string;
  active?: boolean;
  children: React.ReactNode;
}

// The tab bar's icon button, shared by every action group in it (mode toggles,
// AI chat, and the command palette and graph shortcuts).
export function ActionBarButton({
  onClick,
  label,
  title = label,
  active,
  children,
}: ActionBarButtonProps) {
  return (
    <button
      type="button"
      className="mode-toggle-btn"
      data-active={active || undefined}
      onClick={onClick}
      aria-label={label}
      title={title}
    >
      {children}
    </button>
  );
}
