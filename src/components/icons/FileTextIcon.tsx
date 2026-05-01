export function FileTextIcon({ className = "" }: { className?: string }) {
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
      <path d="M3 1.5h5L11 4.5V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2.5a1 1 0 0 1 1-1Z" />
      <path d="M8 1.5V5h3" />
      <path d="M4.5 7.5h5" />
      <path d="M4.5 9.5h5" />
      <path d="M4.5 11.5h3" />
    </svg>
  );
}
