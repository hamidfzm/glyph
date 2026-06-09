import { MenuIconBase } from "./MenuIconBase";

// "New canvas" — file-tree context menu icon. A board of connected cards.
export function NewCanvasIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <rect x="1.5" y="2.5" width="4" height="3.5" rx="0.5" />
      <rect x="8.5" y="7.5" width="4" height="3.5" rx="0.5" />
      <path d="M5.5 4.25h1.5a1 1 0 0 1 1 1V7.5" />
    </MenuIconBase>
  );
}
