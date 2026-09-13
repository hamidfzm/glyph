import { useTranslation } from "react-i18next";
import { PluginStatusBarItems } from "@/components/plugins/PluginStatusBarItems";
import { useTabsContext } from "@/contexts/TabsContext";
import { useNoteZoomMap } from "@/contexts/ZoomContext";
import { useSettings } from "@/hooks/useSettings";
import { isCanvasFile } from "@/lib/canvasExtensions";
import { countWords, readingMinutes } from "@/lib/markdown";
import { ZOOM_DEFAULT } from "@/lib/settingsDisplay";
import { SyncStatusIndicator } from "./SyncStatusIndicator";

interface StatusBarProps {
  // `null` when the cloud-sync feature flag is off, in which case the sync
  // status pill is hidden entirely.
  onOpenSync: (() => void) | null;
}

export function StatusBar({ onOpenSync }: StatusBarProps) {
  const { t } = useTranslation("common");
  const { settings } = useSettings();
  const { activeFile, activeTabId, displayContent } = useTabsContext();
  const noteZoomMap = useNoteZoomMap();
  // The saved font ratio, scaled by the active note tab's temporary multiplier
  // (Ctrl/Cmd +/-/0 or Ctrl/Cmd+scroll). Non-note tabs have no multiplier.
  const noteMultiplier = activeTabId ? (noteZoomMap?.[activeTabId] ?? 1) : 1;
  const zoomPercent = Math.round(
    (settings.appearance.fontSize / ZOOM_DEFAULT) * noteMultiplier * 100,
  );

  if (!activeTabId) return null;

  const filePath = activeFile?.path;
  // Text stats and font zoom are for notes only. A canvas has displayContent
  // (its projected card text) but no reading order, and zooms on its own.
  const isCanvas = !!filePath && isCanvasFile(filePath);
  const isNote = !!displayContent && !isCanvas;
  const words = isNote ? countWords(displayContent) : 0;

  return (
    <div
      data-print-hide="true"
      className="status-bar flex items-center gap-4 px-4 min-h-7 border-t border-[var(--color-border)] text-xs text-[var(--color-text-secondary)] select-none shrink-0"
    >
      {filePath && (
        // Hidden on mobile (see platform.css): the path there is an opaque
        // `content://…` picker URI, long and meaningless, and it crowds the
        // word count / reading time off a narrow bar.
        <span className="status-bar-path truncate max-w-[50%]" title={filePath}>
          {filePath}
        </span>
      )}
      <div className="ms-auto flex flex-wrap items-center gap-4">
        {isNote && (
          <>
            <span>{t("statusBar.words", { count: words, formatted: words.toLocaleString() })}</span>
            <span>{t("statusBar.readingTime", { count: readingMinutes(words) })}</span>
            {zoomPercent !== 100 && <span>{zoomPercent}%</span>}
          </>
        )}
        <PluginStatusBarItems />
        {onOpenSync && <SyncStatusIndicator onOpenSync={onOpenSync} />}
      </div>
    </div>
  );
}
