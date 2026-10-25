import { useTranslation } from "react-i18next";
import { BannerCloseIcon } from "@/components/icons/BannerCloseIcon";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { WarningIcon } from "@/components/icons/WarningIcon";
import type { ExportNoticeContent } from "@/hooks/useExportNotice";
import { type ExportNoticeTone, exportNoticeTone } from "@/lib/exportNoticeTone";

interface ExportNoticeProps {
  notice: ExportNoticeContent;
  onDismiss: () => void;
}

const ACCENT_CLASS: Record<ExportNoticeTone, string> = {
  info: "border-s-[var(--color-accent)] text-[var(--color-accent)]",
  warning: "border-s-[var(--color-warning,#b45309)] text-[var(--color-warning,#b45309)]",
  error: "border-s-[var(--color-error)] text-[var(--color-error)]",
};

/**
 * Toast for an export that needs the user's attention after it ended. A
 * website that was written with something falling short is a warning, one
 * message per shortfall; a refusal or a failed export is an error. A copied
 * share link is information: the link carries the whole document. Unlike the
 * progress toast it does not go away on its own: an export can outlast the
 * user's attention.
 */
export function ExportNotice({ notice, onDismiss }: ExportNoticeProps) {
  const { t } = useTranslation("common");
  const tone = exportNoticeTone(notice);
  const messages = notice.kind === "siteWarnings" ? notice.warnings : [notice];
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      data-export-ignore="true"
      className={`pointer-events-auto flex items-start gap-3 max-w-[min(32rem,90vw)] px-4 py-2 rounded-lg border border-[var(--color-border)] border-s-4 bg-[var(--color-surface)] text-sm shadow-lg ${ACCENT_CLASS[tone]}`}
    >
      <span className="mt-1 shrink-0">{tone === "info" ? <CheckIcon /> : <WarningIcon />}</span>
      <div className="min-w-0 max-h-[40vh] overflow-y-auto wrap-break-word space-y-3 text-[var(--color-text-primary)]">
        {messages.map((message) => (
          <div key={message.kind}>
            <p>{t(`exportNotice.${message.kind}`)}</p>
            {/* Isolated: the reason is in its source's language and may hold a path. */}
            {"reason" in message && (
              <bdi className="block mt-1 text-[var(--color-text-secondary)]">{message.reason}</bdi>
            )}
            {"more" in message && message.more > 0 && (
              <p className="mt-1 text-[var(--color-text-secondary)]">
                {t("exportNotice.assetsFailedMore", { count: message.more })}
              </p>
            )}
          </div>
        ))}
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
