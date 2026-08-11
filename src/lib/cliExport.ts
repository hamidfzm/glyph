import { invoke } from "@tauri-apps/api/core";
import type { ExportFormat } from "@/lib/export/writeExport";

/** The export formats the CLI accepts: the document ones plus the website. */
export type CliExportFormat = ExportFormat | "site";

/** A `glyph <path> --export <format> [--out <path>]` launch, as stashed by Rust. */
export interface CliExportRequest {
  input: string;
  format: CliExportFormat;
  output: string;
}

let requestPromise: Promise<CliExportRequest | null> | null = null;

/**
 * The CLI export request this process was launched with, if any. Cached
 * module-wide: the window-reveal gate and the export runner both ask, and must
 * agree on one answer. Resolves null outside Tauri (tests) or on a normal
 * interactive launch.
 */
export function getCliExportRequest(): Promise<CliExportRequest | null> {
  if (!requestPromise) {
    requestPromise = invoke<CliExportRequest | null>("get_cli_export").catch(() => null);
  }
  return requestPromise;
}

/** Test-only: forget the cached answer so each test can stub its own. */
export function resetCliExportRequestCache(): void {
  requestPromise = null;
}
