import { MenuIconBase } from "./MenuIconBase";

// "Rename" — file-tree context menu icon.
export function RenameIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M9.5 2.5 11.5 4.5 5 11l-2.5.5L3 9z" />
      <path d="M8.5 3.5 10.5 5.5" />
    </MenuIconBase>
  );
}
