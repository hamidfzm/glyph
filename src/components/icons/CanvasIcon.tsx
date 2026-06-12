// Canvas document — file-tree entry icon: two connected cards on a board.
export function CanvasIcon({ className = "" }: { className?: string }) {
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
      <rect x="1.5" y="2" width="4.5" height="3.5" rx="0.8" />
      <rect x="8" y="8.5" width="4.5" height="3.5" rx="0.8" />
      <path d="M6 3.75h2.5a1.5 1.5 0 0 1 1.5 1.5V8.5" />
    </svg>
  );
}
