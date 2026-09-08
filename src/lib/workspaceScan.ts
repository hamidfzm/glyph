// Mirrors the Rust `ScanStatus` that rides on `list_markdown_files` and on the
// vault snapshot: whether a scan covered every file, and which configured cap
// cut it short.
export interface ScanStatus {
  truncated: boolean;
  reason: "fileLimit" | "depthLimit" | null;
  limit: number | null;
}

export interface FileScan {
  files: string[];
  status: ScanStatus;
}

export const COMPLETE_SCAN: ScanStatus = { truncated: false, reason: null, limit: null };

export function sameScanStatus(a: ScanStatus, b: ScanStatus): boolean {
  return a.truncated === b.truncated && a.reason === b.reason && a.limit === b.limit;
}

/** Translation key (workspace namespace) describing a truncated scan. */
export function indexIncompleteKey(reason: ScanStatus["reason"]): string {
  return reason === "depthLimit" ? "notice.indexIncompleteDepth" : "notice.indexIncompleteFiles";
}
