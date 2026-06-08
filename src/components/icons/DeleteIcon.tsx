import { MenuIconBase } from "./MenuIconBase";

// "Delete" — file-tree context menu icon (trash can).
export function DeleteIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M2.5 4h9" />
      <path d="M5.25 4V2.75a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1V4" />
      <path d="M3.75 4 4.25 11.5a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1L10.25 4" />
      <path d="M6 6.5v4M8 6.5v4" />
    </MenuIconBase>
  );
}
