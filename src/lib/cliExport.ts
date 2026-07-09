import { invoke } from "@tauri-apps/api/core";

/** A `glyph <folder> --export-website <outDir>` launch, as stashed by Rust. */
export interface CliExportRequest {
  root: string;
  outDir: string;
}

let requestPromise: Promise<CliExportRequest | null> | null = null;

/**
 * The CLI website-export request this process was launched with, if any.
 * Cached module-wide: the window-reveal gate and the export runner both ask,
 * and must agree on one answer. Resolves null outside Tauri (tests) or on a
 * normal interactive launch.
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
