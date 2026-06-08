import type { ReactNode } from "react";

// Shared 14px line-icon frame for the file-tree menu icons. Each icon lives in
// its own file (one component per file) and supplies only its path geometry.
export function MenuIconBase({
  className = "",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <svg
      className={`inline-block shrink-0 ${className}`}
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
      {children}
    </svg>
  );
}
