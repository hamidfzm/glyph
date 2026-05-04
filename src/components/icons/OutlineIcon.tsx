export function OutlineIcon({
  className = "",
  active = false,
}: {
  className?: string;
  active?: boolean;
}) {
  // Bullet-list style: small dot + line per row, with progressive indent to suggest a TOC.
  return (
    <svg
      className={`inline-block ${className}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="2.5" cy="3" r="0.9" fill={active ? "currentColor" : "none"} />
      <line x1="5" y1="3" x2="12" y2="3" />
      <circle cx="4.5" cy="7" r="0.9" fill={active ? "currentColor" : "none"} />
      <line x1="7" y1="7" x2="12" y2="7" />
      <circle cx="4.5" cy="11" r="0.9" fill={active ? "currentColor" : "none"} />
      <line x1="7" y1="11" x2="12" y2="11" />
    </svg>
  );
}
