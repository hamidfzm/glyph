export function CommandPaletteIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`inline-block ${className}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.4" y="2.4" width="11.2" height="9.2" rx="2" />
      <path d="M4.3 6.1 5.9 7.6 4.3 9.1" />
      <path d="M7.8 9.1h2.2" />
    </svg>
  );
}
