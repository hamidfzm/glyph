import { MenuIconBase } from "./MenuIconBase";

// "Move to…" — file-tree context menu icon (folder with arrow).
export function MoveIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 H11 a1 1 0 0 0 1-1 V5.75 a1 1 0 0 0-1-1 H6.25 L5 3.25 H2.5 a1 1 0 0 0-1 1Z" />
      <path d="M5 8.25 H9" />
      <path d="M7.5 6.75 9 8.25 7.5 9.75" />
    </MenuIconBase>
  );
}
