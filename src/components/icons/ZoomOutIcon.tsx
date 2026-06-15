// Magnifier with a minus, for the lightbox "zoom out" control.
export function ZoomOutIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`inline-block ${className}`}
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
      <path d="M5 7h4" />
    </svg>
  );
}
