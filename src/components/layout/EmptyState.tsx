import { Trans, useTranslation } from "react-i18next";
import type { Platform } from "@/hooks/usePlatform";
import { isMobile, modKey } from "@/lib/platform";

interface EmptyStateProps {
  platform: Platform;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  // True when a folder tab is active but no file has been opened yet: shows a
  // "pick a file" prompt instead of the open-file actions.
  folderEmpty?: boolean;
}

export function EmptyState({ platform, onOpenFile, onOpenFolder, folderEmpty }: EmptyStateProps) {
  const { t } = useTranslation("common");
  // Mobile has no keyboard shortcuts and no folder workspaces: the document
  // picker for single files is the only entry point.
  const mobile = isMobile(platform);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 select-none">
      <div className="text-6xl opacity-20">📄</div>
      <div className="text-center">
        <h2 className="text-xl font-semibold text-[var(--color-text-primary)] mb-2">
          {folderEmpty ? t("emptyState.folderHeading") : t("emptyState.openHeading")}
        </h2>
        {/* folderEmpty can't happen on mobile (no folder workspaces), so the
            hint is simply absent there instead of an empty element. */}
        {!mobile && (
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
        )}
      </div>
      {!folderEmpty && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onOpenFile}
            className="px-4 py-2 text-sm font-medium text-white bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)] rounded-[var(--glyph-radius)] transition-colors"
          >
            {t("emptyState.openFile")}
          </button>
          {!mobile && (
            <button
              type="button"
              onClick={onOpenFolder}
              className="px-4 py-2 text-sm font-medium text-[var(--color-text-primary)] bg-[var(--color-surface-secondary)] hover:bg-[var(--color-surface-tertiary)] border border-[var(--color-border)] rounded-[var(--glyph-radius)] transition-colors"
            >
              {t("emptyState.openFolder")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
