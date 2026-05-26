import { useTabsContext } from "@/contexts/TabsContext";
import { useSettings } from "@/hooks/useSettings";
import { countWords, readingTime } from "@/lib/markdown";
import { ZOOM_DEFAULT } from "@/lib/settings";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

interface StatusBarProps {
  onOpenSync: () => void;
}

export function StatusBar({ onOpenSync }: StatusBarProps) {
  const { settings } = useSettings();
  const { activeFile, activeTab, displayContent } = useTabsContext();
  const zoomPercent = Math.round((settings.appearance.fontSize / ZOOM_DEFAULT) * 100);

  if (!displayContent) return null;

  const filePath = activeFile?.path;
  const words = countWords(displayContent);
  const workspacePath = activeTab?.kind === "folder" ? activeTab.root : null;

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-4 px-4 h-7 border-t border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs text-[var(--color-text-secondary)] select-none shrink-0"
    >
      {filePath && (
        <span className="truncate max-w-[50%]" title={filePath}>
          {filePath}
        </span>
      )}
      <span className="ml-auto">{words.toLocaleString()} words</span>
      <span>{readingTime(words)}</span>
      {zoomPercent !== 100 && <span>{zoomPercent}%</span>}
      <SyncStatusIndicator workspacePath={workspacePath} onOpenSync={onOpenSync} />
    </div>
  );
}
