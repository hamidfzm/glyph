// Inward-pointing corners, for the lightbox "fit to screen" control.
export function FitIcon({ className = "" }: { className?: string }) {
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
      <path d="M6 2H2v4M14 6V2h-4M10 14h4v-4M2 10v4h4" />
    </svg>
  );
}
