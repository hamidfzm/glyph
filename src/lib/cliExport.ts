import { invoke } from "@tauri-apps/api/core";
import type { ExportFormat } from "@/lib/export/writeExport";

/** The export formats the CLI accepts: the document ones plus the website. */
export type CliExportFormat = ExportFormat | "site";

/** A `glyph export <path> --format <format> [--out <path>]` launch, as stashed by Rust. */
export interface CliExportRequest {
  input: string;
  format: CliExportFormat;
  output: string;
}

let requestPromise: Promise<CliExportRequest | null> | null = null;
let isExportProcess = false;

/**
 * The CLI export request this process was launched with, if any. Cached
 * module-wide: the window-reveal gate and the export runner both ask, and must
 * agree on one answer. Resolves null outside Tauri (tests) or on a normal
 * interactive launch.
 */
export function getCliExportRequest(): Promise<CliExportRequest | null> {
  if (!requestPromise) {
    requestPromise = invoke<CliExportRequest | null>("get_cli_export")
      .then((request) => {
        isExportProcess = request !== null;
        return request;
      })
      .catch(() => null);
  }
  return requestPromise;
}

/**
 * Whether this process is a headless export, for the paths that must not
 * write user state from one. A CLI export opens the exported document like any
 * other tab, and persisting that would replace the user's saved session and
 * recent files with the exported file, racing the interactive window they
 * already have open.
 *
 * Answers false until the probe resolves, which happens on mount, well before
 * a document is opened (that needs its own IPC round trips).
 */
export function isCliExportProcess(): boolean {
  return isExportProcess;
}

/** Test-only: forget the cached answer so each test can stub its own. */
export function resetCliExportRequestCache(): void {
  requestPromise = null;
  isExportProcess = false;
}
