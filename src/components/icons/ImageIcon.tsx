// Image / SVG asset — file-tree entry icon: a framed picture with a sun and a
// mountain horizon.
export function ImageIcon({ className = "" }: { className?: string }) {
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
      <rect x="1.75" y="2.25" width="10.5" height="9.5" rx="1.2" />
      <circle cx="5" cy="5.25" r="1" />
      <path d="M2.25 9.5 5 7l2 1.75L9.5 6l2.25 2.25" />
    </svg>
  );
}
