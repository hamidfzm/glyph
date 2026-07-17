// Small warning triangle for inline notices (incomplete workspace index).
export function WarningIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path
        d="M7 1.5L13 12H1L7 1.5z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M7 5.5v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="7" cy="10.2" r="0.7" fill="currentColor" />
    </svg>
  );
}
