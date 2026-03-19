interface TitlebarProps {
  fileName?: string;
}

export function Titlebar({ fileName }: TitlebarProps) {
  return (
    <div
      data-tauri-drag-region
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center border-b border-[var(--color-border)]"
      style={{
        height: "var(--glyph-titlebar-height)",
        background: "var(--glyph-sidebar-bg)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      {/* Traffic light spacer */}
      <div className="absolute left-0 top-0 w-20 h-full" />
      <span
        data-tauri-drag-region
        className="text-sm text-[var(--color-text-secondary)] select-none truncate max-w-[50%]"
      >
        {fileName || "Glyph"}
      </span>
    </div>
  );
}
