// Left-pointing chevron, mirror of ChevronRightIcon. Used for lightbox
// "previous image" navigation.
export function ChevronLeftIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`inline-block ${className}`}
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6.5 2.5L3.5 5l3 2.5" />
    </svg>
  );
}
