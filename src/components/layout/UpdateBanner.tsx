import { openUrl } from "@tauri-apps/plugin-opener";
import { Trans, useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";
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
  const { t } = useTranslation("common");
  if (!update) return null;

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-l-4 border-l-[var(--color-accent)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      <span>
        <Trans
          i18nKey="updateBanner.available"
          ns="common"
          values={{ version: update.latestVersion }}
          components={{ strong: <span className="font-semibold" /> }}
        />
        <span className="text-[var(--color-text-secondary)]">
          {" "}
          {t("updateBanner.currentVersion", { version: update.currentVersion })}
        </span>
      </span>
      <button
        type="button"
        className="ml-auto cursor-pointer rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
        onClick={() => void openUrl(update.url)}
      >
        {t("updateBanner.download")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDismiss}
        aria-label={t("updateBanner.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
