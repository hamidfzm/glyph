export function GraphIcon({ className = "" }: { className?: string }) {
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
      <circle cx="3.5" cy="3.5" r="1.8" />
      <circle cx="10.5" cy="5" r="1.8" />
      <circle cx="6" cy="10.5" r="1.8" />
      <path d="M5.2 4 8.8 4.6M4.2 5.2 5.4 8.9M9.6 6.5 7 9.2" />
    </svg>
  );
}
