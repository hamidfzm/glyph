import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";

interface ErrorReportingBannerProps {
  onEnable: () => void;
  onDecline: () => void;
}

/**
 * First-run nudge to opt into crash reporting. "Enable" turns the setting on;
 * "No thanks" and the close button decline permanently. Mirrors
 * {@link DefaultAppBanner}.
 */
export function ErrorReportingBanner({ onEnable, onDecline }: ErrorReportingBannerProps) {
  const { t } = useTranslation("common");

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-s-4 border-s-[var(--color-accent)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      <span>{t("errorReportingBanner.message")}</span>
      <button
        type="button"
        className="ms-auto cursor-pointer rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)]"
        onClick={onEnable}
      >
        {t("errorReportingBanner.enable")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDecline}
      >
        {t("errorReportingBanner.noThanks")}
      </button>
      <button
        type="button"
        className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={onDecline}
        aria-label={t("errorReportingBanner.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
