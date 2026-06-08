import { MenuIconBase } from "./MenuIconBase";

// "Reveal in file explorer" — file-tree context menu icon.
export function RevealIcon({ className }: { className?: string }) {
  return (
    <MenuIconBase className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 H8" />
      <path d="M1.5 4.25 V3.5 a1 1 0 0 1 1-1 H5 l1.25 1.5 H11 a1 1 0 0 1 1 1 V7" />
      <path d="M9 12 12.5 12 M12.5 12 V8.5 M12.5 12 8.5 8" />
    </MenuIconBase>
  );
}
