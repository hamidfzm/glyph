// A scrollable sidebar column with a border on the edge facing the content
// area. Holds the file-tree and/or outline blocks.
export function SidebarPanel({
  width,
  side,
  children,
}: {
  width: number;
  side: "left" | "right";
  children: React.ReactNode;
}) {
  const borderClass = side === "left" ? "border-r" : "border-l";
  return (
    <nav
      data-print-hide="true"
      data-sidebar={side}
      className={`shrink-0 flex flex-col overflow-y-auto ${borderClass} border-[var(--color-border)] select-none pt-3`}
      style={{ width, background: "var(--glyph-sidebar-bg)" }}
    >
      {children}
    </nav>
  );
}
