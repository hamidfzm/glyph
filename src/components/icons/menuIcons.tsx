// Small 14px line icons for the file-tree context menu. Grouped in one module
// because they're a single cohesive set used only by that menu.

type IconProps = { className?: string };

function Svg({ className = "", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      className={`inline-block shrink-0 ${className}`}
      width="14"
      height="14"
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function OpenIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2 3.5h3.5L7 5h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z" />
    </Svg>
  );
}

export function NewTabIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="1.75" y="1.75" width="10.5" height="10.5" rx="1.5" />
      <path d="M7 4.5v5M4.5 7h5" />
    </Svg>
  );
}

export function RenameIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M9.5 2.5 11.5 4.5 5 11l-2.5.5L3 9z" />
      <path d="M8.5 3.5 10.5 5.5" />
    </Svg>
  );
}

export function NewNoteIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M3 1.5h4L11 5v3.5" />
      <path d="M7 1.5V5h3.5" />
      <path d="M3 1.5a1 1 0 0 0-1 1V11a1 1 0 0 0 1 1h3" />
      <path d="M10.5 9.5v4M8.5 11.5h4" />
    </Svg>
  );
}

export function NewFolderIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 h6" />
      <path d="M1.5 4.25 V3.5 a1 1 0 0 1 1-1 H5 l1.25 1.5 H11 a1 1 0 0 1 1 1 V7" />
      <path d="M10.5 9.5v4M8.5 11.5h4" />
    </Svg>
  );
}

export function DuplicateIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <rect x="5" y="5" width="7.5" height="7.5" rx="1.5" />
      <path d="M9.5 5V3.5a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1V9a1 1 0 0 0 1 1h1.5" />
    </Svg>
  );
}

export function CopyPathIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M6 8.5 8.5 6a2 2 0 0 1 3 3L10 10.5a2 2 0 0 1-3 0" />
      <path d="M8 5.5 5.5 8a2 2 0 0 1-3-3L4 3.5a2 2 0 0 1 3 0" />
    </Svg>
  );
}

export function RevealIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 H8" />
      <path d="M1.5 4.25 V3.5 a1 1 0 0 1 1-1 H5 l1.25 1.5 H11 a1 1 0 0 1 1 1 V7" />
      <path d="M9 12 12.5 12 M12.5 12 V8.5 M12.5 12 8.5 8" />
    </Svg>
  );
}

export function MoveIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M1.5 4.25 V11 a1 1 0 0 0 1 1 H11 a1 1 0 0 0 1-1 V5.75 a1 1 0 0 0-1-1 H6.25 L5 3.25 H2.5 a1 1 0 0 0-1 1Z" />
      <path d="M5 8.25 H9" />
      <path d="M7.5 6.75 9 8.25 7.5 9.75" />
    </Svg>
  );
}

export function CollapseAllIcon({ className }: IconProps) {
  // Chevrons pointing inward (toward each other) = collapse.
  return (
    <Svg className={className}>
      <path d="M4.5 3.5 7 6l2.5-2.5" />
      <path d="M4.5 10.5 7 8l2.5 2.5" />
    </Svg>
  );
}

export function ExpandAllIcon({ className }: IconProps) {
  // Chevrons pointing outward (away from each other) = expand.
  return (
    <Svg className={className}>
      <path d="M4.5 6 7 3.5 9.5 6" />
      <path d="M4.5 8 7 10.5 9.5 8" />
    </Svg>
  );
}

export function DeleteIcon({ className }: IconProps) {
  return (
    <Svg className={className}>
      <path d="M2.5 4h9" />
      <path d="M5.25 4V2.75a1 1 0 0 1 1-1h1.5a1 1 0 0 1 1 1V4" />
      <path d="M3.75 4 4.25 11.5a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1L10.25 4" />
      <path d="M6 6.5v4M8 6.5v4" />
    </Svg>
  );
}
