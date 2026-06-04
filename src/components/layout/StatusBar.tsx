import { useTabsContext } from "@/contexts/TabsContext";
import { useSettings } from "@/hooks/useSettings";
import { countWords, readingTime } from "@/lib/markdown";
import { isNotebookFile } from "@/lib/notebookExtensions";
import { ZOOM_DEFAULT } from "@/lib/settings";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

interface StatusBarProps {
  // `null` when the cloud-sync feature flag is off, in which case the sync
  // status pill is hidden entirely.
  onOpenSync: (() => void) | null;
}

export function StatusBar({ onOpenSync }: StatusBarProps) {
  const { settings } = useSettings();
  const { activeFile, activeTab, displayContent } = useTabsContext();
  const zoomPercent = Math.round((settings.appearance.fontSize / ZOOM_DEFAULT) * 100);

  const filePath = activeFile?.path;
  // Notebooks suppress `displayContent` (it would be raw JSON) in every mode,
  // so the word count / reading time don't apply — show a document-type label
  // instead.
  const isNotebook = !!filePath && isNotebookFile(filePath);

  if (!displayContent && !isNotebook) return null;

  const words = displayContent ? countWords(displayContent) : 0;
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
      {isNotebook ? (
        <span className="ml-auto">Jupyter Notebook</span>
      ) : (
        <>
          <span className="ml-auto">{words.toLocaleString()} words</span>
          <span>{readingTime(words)}</span>
        </>
      )}
      {zoomPercent !== 100 && <span>{zoomPercent}%</span>}
      {onOpenSync && <SyncStatusIndicator workspacePath={workspacePath} onOpenSync={onOpenSync} />}
    </div>
  );
}
