import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";
import type { DefaultAppOutcome } from "@/lib/defaultApp";

interface DefaultAppBannerProps {
  /** What "Set as default" came back with when it set nothing; null while asking. */
  outcome: DefaultAppOutcome | null;
  busy: boolean;
  onSetDefault: () => void;
  onNotNow: () => void;
  onNever: () => void;
  onDismissOutcome: () => void;
}

/**
 * First-run nudge to make Glyph the default Markdown app. "Set as default"
 * triggers the platform registration; "Not now" and the close button dismiss
 * for now; "Never" stops it from returning. When the registration set nothing,
 * the question gives way to the same outcome line Settings shows, and only the
 * close button is left. Mirrors {@link UpdateBanner}.
 */
export function DefaultAppBanner({
  outcome,
  busy,
  onSetDefault,
  onNotNow,
  onNever,
  onDismissOutcome,
}: DefaultAppBannerProps) {
  const { t } = useTranslation(["common", "settings"]);
  const asking = outcome === null;

  return (
    <div
      data-print-hide="true"
      className="flex items-center gap-3 px-4 py-2 border-b border-[var(--color-border)] border-s-4 border-s-[var(--color-accent)] bg-[var(--color-banner-bg)] text-sm text-[var(--color-text-primary)] select-none shrink-0"
    >
      {/* Present from the first render so the outcome is announced when it replaces the question. */}
      <span role="status" className="me-auto">
        {asking
          ? t("defaultAppBanner.message")
          : t(`defaultApp.outcome.${outcome}`, { ns: "settings" })}
      </span>
      {asking && (
        <>
          <button
            type="button"
            className="cursor-pointer rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[var(--color-accent-hover)] disabled:cursor-default disabled:opacity-60"
            onClick={onSetDefault}
            disabled={busy}
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
        </>
      )}
      <button
        type="button"
        className="cursor-pointer text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
        onClick={asking ? onNotNow : onDismissOutcome}
        aria-label={t("defaultAppBanner.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
