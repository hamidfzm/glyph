import type { Platform } from "../hooks/usePlatform";
import { modKey } from "../lib/platform";

interface EmptyStateProps {
  platform: Platform;
  onOpenFile: () => void;
}

export function EmptyState({ platform, onOpenFile }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      <div className="text-6xl opacity-20">📄</div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          Open a Markdown file
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Drop a file here, use the menu, or press{" "}
          <kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--glyph-radius-sm)]">
            {modKey(platform)}+O
          </kbd>
        </p>
      </div>
      <button
        onClick={onOpenFile}
        className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--glyph-radius)] transition-colors"
      >
        Open File
      </button>
    </div>
  );
}
