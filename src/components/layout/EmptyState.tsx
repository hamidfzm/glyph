import { Trans, useTranslation } from "react-i18next";
import { PRIMARY_BUTTON_CLASS, SECONDARY_BUTTON_CLASS } from "@/components/layout/emptyStateStyles";
import { ShowOn } from "@/components/ShowOn";
import type { Platform } from "@/hooks/usePlatform";
import { modKey } from "@/lib/platform";

interface EmptyStateProps {
  platform: Platform;
  onNewDocument: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onNewWorkspace: () => void;
  onNewNote: () => void;
  onNewCanvas: () => void;
  // True when a folder tab is active but no file has been opened yet: shows a
  // "pick a file" prompt instead of the open-file actions.
  folderEmpty?: boolean;
}

export function EmptyState({
  platform,
  onNewDocument,
  onOpenFile,
  onOpenFolder,
  onNewWorkspace,
  onNewNote,
  onNewCanvas,
  folderEmpty,
}: EmptyStateProps) {
  const { t } = useTranslation("common");

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      <div className="text-6xl opacity-20">📄</div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          {folderEmpty ? t("emptyState.folderHeading") : t("emptyState.openHeading")}
        </h2>
        {/* Keyboard-shortcut hint; folderEmpty can't happen on mobile. */}
        <ShowOn on="desktop">
          <p className="text-sm text-[var(--color-text-secondary)]">
            {folderEmpty ? (
              t("emptyState.folderHint")
            ) : (
              <Trans
                i18nKey="emptyState.openHint"
                values={{ shortcut: `${modKey(platform)}+O` }}
                components={{
                  kbd: (
                    <kbd className="px-1.5 py-0.5 text-xs bg-[var(--color-surface-secondary)] border border-[var(--color-border)] rounded-[var(--glyph-radius-sm)]" />
                  ),
                }}
              />
            )}
          </p>
        </ShowOn>
      </div>
      {folderEmpty && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onNewNote} className={PRIMARY_BUTTON_CLASS}>
            {t("emptyState.newNote")}
          </button>
          <button type="button" onClick={onNewCanvas} className={SECONDARY_BUTTON_CLASS}>
            {t("emptyState.newCanvas")}
          </button>
        </div>
      )}
      {!folderEmpty && (
        <div className="flex items-center gap-2">
          <button type="button" onClick={onNewDocument} className={PRIMARY_BUTTON_CLASS}>
            {t("emptyState.newDocument")}
          </button>
          <button type="button" onClick={onOpenFile} className={SECONDARY_BUTTON_CLASS}>
            {t("emptyState.openFile")}
          </button>
          {/* No folder workspaces on mobile. */}
          <ShowOn on="desktop">
            <button type="button" onClick={onOpenFolder} className={SECONDARY_BUTTON_CLASS}>
              {t("emptyState.openFolder")}
            </button>
            <button type="button" onClick={onNewWorkspace} className={SECONDARY_BUTTON_CLASS}>
              {t("emptyState.newWorkspace")}
            </button>
          </ShowOn>
        </div>
      )}
    </div>
  );
}
