export function UserIcon({ className = "" }: { className?: string }) {
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
      <circle cx="7" cy="4.5" r="2.5" />
      <path d="M2 12.5c0-2.2 2.2-4 5-4s5 1.8 5 4" />
    </svg>
  );
}
