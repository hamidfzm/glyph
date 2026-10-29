import type { ExportNoticeContent } from "@/hooks/useExportNotice";

export type ExportNoticeTone = "info" | "warning" | "error";

/** A copied share link informs, a website's shortfalls warn, anything else failed. */
export function exportNoticeTone(notice: ExportNoticeContent): ExportNoticeTone {
  if (notice.kind === "linkCopied") return "info";
  if (notice.kind === "siteWarnings") return "warning";
  return "error";
}
