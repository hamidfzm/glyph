import { invoke } from "@tauri-apps/api/core";

/** A `glyph serve <dir>` launch, as stashed by Rust. */
export interface CliServeRequest {
  /** Absolute workspace folder to render and watch. */
  root: string;
  /** Absolute directory the site is written to and served from. */
  outDir: string;
}

let requestPromise: Promise<CliServeRequest | null> | null = null;

/**
 * What this process was asked to serve, if anything. Cached module-wide for
 * the same reason as the export request: the window-reveal gate and the serve
 * runner both ask, and a serve process must not be revealed by one of them
 * while the other renders. Resolves null outside Tauri (tests) and on every
 * launch that is not `glyph serve`.
 */
export function getCliServeRequest(): Promise<CliServeRequest | null> {
  if (!requestPromise) {
    requestPromise = invoke<CliServeRequest | null>("get_cli_serve").catch(() => null);
  }
  return requestPromise;
}

/** Test-only: forget the cached answer so each test can stub its own. */
export function resetCliServeRequestCache(): void {
  requestPromise = null;
}
