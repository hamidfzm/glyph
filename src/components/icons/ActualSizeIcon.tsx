// "1:1" glyph, for the lightbox "actual size" control.
export function ActualSizeIcon({ className = "" }: { className?: string }) {
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
      <path d="M3 5.5L4.5 4.5V11.5" />
      <path d="M11.5 5.5L13 4.5V11.5" />
      <circle cx="8" cy="5" r="0.25" />
      <circle cx="8" cy="11" r="0.25" />
    </svg>
  );
}
