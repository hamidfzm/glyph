import { MenuIconBase } from "./MenuIconBase";

// "Sort by count" — bars shortening downward, the way the tag list reads once
// the most frequent tag is on top.
export function SortByCountIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M3 3.5h8" />
      <path d="M3 7h5" />
      <path d="M3 10.5h2.5" />
    </MenuIconBase>
  );
}
