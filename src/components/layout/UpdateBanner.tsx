import { openUrl } from "@tauri-apps/plugin-opener";
import type { AvailableUpdate } from "@/lib/updateCheck";

interface UpdateBannerProps {
  update: AvailableUpdate | null;
  onDismiss: () => void;
}

/**
 * Thin notification bar shown at the top of the app when a newer release is
 * available. "Download" opens the release page in the browser (the app is
 * distributed through package managers, so we never self-update); the close
 * button hides it for the session.
 */
export function UpdateBanner({ update, onDismiss }: UpdateBannerProps) {
  if (!update) return null;

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-3 px-4 py-1.5 border-b border-[var(--color-border)] bg-[var(--color-surface-secondary)] text-xs text-[var(--color-text-primary)] shrink-0"
    >
      <span>
        Glyph {update.latestVersion} is available
        <span className="text-[var(--color-text-secondary)]">
          {" "}
          (you have {update.currentVersion})
        </span>
      </span>
      <button
        type="button"
        className="ml-auto font-medium text-[var(--color-accent)] hover:underline"
        onClick={() => void openUrl(update.url)}
      >
        Download
      </button>
      <button
        type="button"
        className="text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDismiss}
        aria-label="Dismiss update notification"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden="true">
          <path
            d="M3 3l8 8M11 3l-8 8"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
