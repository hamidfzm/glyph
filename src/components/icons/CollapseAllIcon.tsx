import { MenuIconBase } from "./MenuIconBase";

// "Collapse all" — chevrons pointing inward (toward each other).
export function CollapseAllIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M4.5 3.5 7 6l2.5-2.5" />
      <path d="M4.5 10.5 7 8l2.5 2.5" />
    </MenuIconBase>
  );
}
