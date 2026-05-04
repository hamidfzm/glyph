export function SidebarLeftIcon({
  className = "",
  active = false,
}: {
  className?: string;
  active?: boolean;
}) {
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
      <rect x="1.5" y="2" width="11" height="10" rx="1.5" />
      <line x1="5.5" y1="2" x2="5.5" y2="12" />
      {active && <rect x="1.5" y="2" width="4" height="10" fill="currentColor" opacity="0.18" />}
    </svg>
  );
}
