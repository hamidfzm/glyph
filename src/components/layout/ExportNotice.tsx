import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";
import { WarningIcon } from "@/components/icons/WarningIcon";
import type { SiteExportNotice } from "@/hooks/useExportSite";

interface ExportNoticeProps {
  notice: SiteExportNotice;
  onDismiss: () => void;
}

const ACCENT_CLASS = {
  warning: "border-s-[var(--color-warning,#b45309)] text-[var(--color-warning,#b45309)]",
  error: "border-s-[var(--color-error)] text-[var(--color-error)]",
} as const;

/**
 * Toast for a website export that needs the user's attention after it ended.
 * A cleanup failure is a warning (the site itself is complete); a refusal or a
 * failed export is an error. Unlike the progress toast it does not go away on
 * its own: an export can outlast the user's attention.
 */
export function ExportNotice({ notice, onDismiss }: ExportNoticeProps) {
  const { t } = useTranslation("common");
  const tone = notice.kind === "pruneFailed" ? "warning" : "error";
  return (
    <div
      role="alert"
      data-export-ignore="true"
      className={`pointer-events-auto flex items-start gap-3 max-w-[min(32rem,90vw)] px-4 py-2 rounded-lg border border-[var(--color-border)] border-s-4 bg-[var(--color-surface)] text-sm shadow-lg ${ACCENT_CLASS[tone]}`}
    >
      <span className="mt-1 shrink-0">
        <WarningIcon />
      </span>
      <div className="min-w-0 max-h-[40vh] overflow-y-auto wrap-break-word text-[var(--color-text-primary)]">
        <p>{t(`exportNotice.${notice.kind}`)}</p>
        {/* Isolated: the reason is in the backend's language and may hold a path. */}
        {"reason" in notice && (
          <bdi className="block mt-1 text-[var(--color-text-secondary)]">{notice.reason}</bdi>
        )}
      </div>
      <button
        type="button"
        className="-my-0.5 -mx-1.5 p-1.5 shrink-0 cursor-pointer rounded-[var(--glyph-radius-sm)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--color-accent)]"
        onClick={onDismiss}
        aria-label={t("exportNotice.dismiss")}
      >
        <BannerCloseIcon />
      </button>
    </div>
  );
}
