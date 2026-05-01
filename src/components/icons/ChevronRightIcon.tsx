export function ChevronRightIcon({
  className = "",
  expanded = false,
}: {
  className?: string;
  expanded?: boolean;
}) {
  return (
    <svg
      className={`inline-block transition-transform ${expanded ? "rotate-90" : ""} ${className}`}
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
      <path d="M3.5 2.5L6.5 5l-3 2.5" />
    </svg>
  );
}
