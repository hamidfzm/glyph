import { MenuIconBase } from "./MenuIconBase";

// "Open in new tab" — file-tree context menu icon.
export function NewTabIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <rect x="1.75" y="1.75" width="10.5" height="10.5" rx="1.5" />
      <path d="M7 4.5v5M4.5 7h5" />
    </MenuIconBase>
  );
}
