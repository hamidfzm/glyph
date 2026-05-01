import type { Platform } from "../../hooks/usePlatform";
import { modKey } from "../../lib/platform";

interface EmptyStateProps {
  platform: Platform;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  // Optional override message — used when a folder tab is active but no file has been opened yet.
  hint?: string;
}

export function EmptyState({ platform, onOpenFile, onOpenFolder, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      <div className="text-6xl opacity-20">📄</div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          {hint ? "No file open in this folder" : "Open a Markdown file"}
        </h2>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {hint ?? (
            <>
              Drop a file here, use the menu, or press{" "}
              <kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--glyph-radius-sm)]">
                {modKey(platform)}+O
              </kbd>
            </>
          )}
        </p>
      </div>
      {!hint && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenFile}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--glyph-radius)] transition-colors"
          >
            Open File
          </button>
          <button
            type="button"
            onClick={onOpenFolder}
            className="px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] border border-[var(--color-border)] rounded-[var(--glyph-radius)] transition-colors"
          >
            Open Folder
          </button>
        </div>
      )}
    </div>
  );
}
