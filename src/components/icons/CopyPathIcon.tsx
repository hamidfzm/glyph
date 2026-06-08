import { MenuIconBase } from "./MenuIconBase";

// "Copy path" — file-tree context menu icon (link/chain glyph).
export function CopyPathIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M6 8.5 8.5 6a2 2 0 0 1 3 3L10 10.5a2 2 0 0 1-3 0" />
      <path d="M8 5.5 5.5 8a2 2 0 0 1-3-3L4 3.5a2 2 0 0 1 3 0" />
    </MenuIconBase>
  );
}
