export function FolderOpenIcon({ className = "" }: { className?: string }) {
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
      <path d="M1.5 5V4a1 1 0 0 1 1-1h2.5l1.5 1.5h5a1 1 0 0 1 1 1V6" />
      <path d="M1.5 6h11l-1.2 5a1 1 0 0 1-1 .8H2.7a1 1 0 0 1-1-.8L1.5 6Z" />
    </svg>
  );
}
