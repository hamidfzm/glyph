// Chevron pointing in the given direction. Used inside sidebar panel headers
// to indicate "collapse this panel" (the chevron points away from the content
// area, toward the panel's outer edge).
export function PanelCollapseIcon({
  className = "",
  direction = "left",
}: {
  className?: string;
  direction?: "left" | "right";
}) {
  return (
    <svg
      className={`inline-block ${className}`}
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === "left" ? <path d="M7 2.5L3.5 6 7 9.5" /> : <path d="M5 2.5L8.5 6 5 9.5" />}
    </svg>
  );
}
