import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";

interface DefaultAppBannerProps {
  onSetDefault: () => void;
  onNotNow: () => void;
  onNever: () => void;
}

/**
 * First-run nudge to make Glyph the default Markdown app. "Set as default"
 * triggers the platform registration; "Not now" and the close button dismiss
 * for now; "Never" stops it from returning. Mirrors {@link UpdateBanner}.
 */
export function DefaultAppBanner({ onSetDefault, onNotNow, onNever }: DefaultAppBannerProps) {
  const { t } = useTranslation("common");

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-s-4 border-s-[var(--color-accent)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      <span>{t("defaultAppBanner.message")}</span>
      <button
        type="button"
        className="ms-auto cursor-pointer rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
        onClick={onSetDefault}
      >
        {t("defaultAppBanner.setDefault")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onNotNow}
      >
        {t("defaultAppBanner.notNow")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onNever}
      >
        {t("defaultAppBanner.never")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onNotNow}
        aria-label={t("defaultAppBanner.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
