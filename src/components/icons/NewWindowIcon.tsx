import { MenuIconBase } from "./MenuIconBase";

// "Open in new window" — a second window offset in front of the first.
export function NewWindowIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M2 2.5h6a1 1 0 0 1 1 1V5H6a1 1 0 0 0-1 1v3H2a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M6 6h6a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z" />
    </MenuIconBase>
  );
}
