import { MenuIconBase } from "./MenuIconBase";

// "New folder" — file-tree context menu / toolbar icon.
export function NewFolderIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 h6" />
      <path d="M1.5 4.25 V3.5 a1 1 0 0 1 1-1 H5 l1.25 1.5 H11 a1 1 0 0 1 1 1 V7" />
      <path d="M10.5 9.5v4M8.5 11.5h4" />
    </MenuIconBase>
  );
}
