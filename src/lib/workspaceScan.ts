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

/**
 * The two walks a workspace runs, and how far each got.
 *
 * `files` lists every openable document (markdown, notebooks, canvases, D2);
 * `vault` is the note index, which covers markdown and canvases only. They
 * share a walker and its caps but count different files against them, so a
 * workspace full of notebooks can truncate one walk and not the other.
 */
export interface WorkspaceIndexStatus {
  files: ScanStatus;
  vault: ScanStatus;
}

export const COMPLETE_SCAN: ScanStatus = { truncated: false, reason: null, limit: null };

export const COMPLETE_INDEX_STATUS: WorkspaceIndexStatus = {
  files: COMPLETE_SCAN,
  vault: COMPLETE_SCAN,
};

export function sameScanStatus(a: ScanStatus, b: ScanStatus): boolean {
  return a.truncated === b.truncated && a.reason === b.reason && a.limit === b.limit;
}

/** The status to surface when either walk is incomplete (the file scan wins). */
export function truncatedScan(status: WorkspaceIndexStatus): ScanStatus | null {
  if (status.files.truncated) return status.files;
  if (status.vault.truncated) return status.vault;
  return null;
}

/** Translation key (workspace namespace) describing a truncated scan. */
export function indexIncompleteKey(reason: ScanStatus["reason"]): string {
  return reason === "depthLimit" ? "notice.indexIncompleteDepth" : "notice.indexIncompleteFiles";
}
