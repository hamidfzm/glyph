interface SearchToggleProps {
  /** Symbolic glyph shown in the button, e.g. "Aa". Not translated. */
  glyph: string;
  /** Translated name of the toggle, used as the accessible name. */
  label: string;
  active: boolean;
  onToggle: () => void;
}

export function SearchToggle({ glyph, label, active, onToggle }: SearchToggleProps) {
  return (
    <button
      type="button"
      className="workspace-search-toggle"
      aria-pressed={active}
      aria-label={label}
      title={label}
      onClick={onToggle}
    >
      {glyph}
    </button>
  );
}
