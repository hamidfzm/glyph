export function CalendarIcon({ className = "" }: { className?: string }) {
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
      <rect x="1.5" y="3" width="11" height="9.5" rx="1.5" />
      <path d="M1.5 6h11" />
      <path d="M4.5 1.5v3" />
      <path d="M9.5 1.5v3" />
    </svg>
  );
}
