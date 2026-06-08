import { MenuIconBase } from "./MenuIconBase";

// "Make a copy" — file-tree context menu icon.
export function DuplicateIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <rect x="5" y="5" width="7.5" height="7.5" rx="1.5" />
      <path d="M9.5 5V3.5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1h1.5" />
    </MenuIconBase>
  );
}
