import { MenuIconBase } from "./MenuIconBase";

// "Open" — file-tree context menu icon.
export function OpenIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M2 3.5h3.5L7 5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    </MenuIconBase>
  );
}
