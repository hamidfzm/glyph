import { MenuIconBase } from "./MenuIconBase";

// "Expand all" — chevrons pointing outward (away from each other).
export function ExpandAllIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M4.5 6 7 3.5 9.5 6" />
      <path d="M4.5 8 7 10.5 9.5 8" />
    </MenuIconBase>
  );
}
