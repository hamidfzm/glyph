import { MenuIconBase } from "./MenuIconBase";

// "New note" — file-tree context menu / toolbar icon.
export function NewNoteIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M3 1.5h4L11 5v3.5" />
      <path d="M7 1.5V5h3.5" />
      <path d="M3 1.5a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h3" />
      <path d="M10.5 9.5v4M8.5 11.5h4" />
    </MenuIconBase>
  );
}
