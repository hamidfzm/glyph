import type { WikilinkRef } from "@/lib/backlinks";

// Mirrors the Rust `ScanStatus` returned by the `list_markdown_files` and
// `scan_wikilinks` commands: whether a workspace scan covered every file, and
// which configured cap cut it short.
export interface ScanStatus {
  truncated: boolean;
  reason: "fileLimit" | "depthLimit" | null;
  limit: number | null;
}

export interface FileScan {
  files: string[];
  status: ScanStatus;
}

export interface WikilinkScan {
  refs: WikilinkRef[];
  status: ScanStatus;
}

/** Scan statuses of both workspace indexes, as tracked by `useTabs`. */
export interface WorkspaceIndexStatus {
  files: ScanStatus;
  wikilinks: ScanStatus;
}

export const COMPLETE_SCAN: ScanStatus = { truncated: false, reason: null, limit: null };

export const COMPLETE_INDEX_STATUS: WorkspaceIndexStatus = {
  files: COMPLETE_SCAN,
  wikilinks: COMPLETE_SCAN,
};

export function sameScanStatus(a: ScanStatus, b: ScanStatus): boolean {
  return a.truncated === b.truncated && a.reason === b.reason && a.limit === b.limit;
}

/** The status to surface when any index is incomplete (the file scan wins). */
export function truncatedScan(status: WorkspaceIndexStatus): ScanStatus | null {
  if (status.files.truncated) return status.files;
  if (status.wikilinks.truncated) return status.wikilinks;
  return null;
}

/** Translation key (workspace namespace) describing a truncated scan. */
export function indexIncompleteKey(reason: ScanStatus["reason"]): string {
  return reason === "depthLimit" ? "notice.indexIncompleteDepth" : "notice.indexIncompleteFiles";
}
