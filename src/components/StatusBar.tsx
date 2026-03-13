import { countWords, readingTime } from "../lib/markdown";

interface StatusBarProps {
  filePath?: string;
  content?: string | null;
}

export function StatusBar({ filePath, content }: StatusBarProps) {
  if (!content) return null;

  const words = countWords(content);

  return (
    <div className="flex items-center gap-4 px-4 h-7 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs text-[var(--color-text-secondary)] select-none shrink-0">
      {filePath && (
        <span className="truncate max-w-[50%]" title={filePath}>
          {filePath}
        </span>
      )}
      <span className="ml-auto">{words.toLocaleString()} words</span>
      <span>{readingTime(words)}</span>
    </div>
  );
}
