import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import * as Sentry from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";

// Public Sentry client identifier for the `glyph` project. DSNs are not secrets
// (they ship in every client app), so hardcoding is fine and intentional.
const SENTRY_DSN =
  "https://0ae4d558b7b6fe1ec29b3ffb7c04fabb@o4511468551340032.ingest.us.sentry.io/4511491763470336";

// Breadcrumb categories that carry navigation URLs / request paths — dropped
// wholesale so we never ship the user's file locations or any remote URLs.
const URL_BEARING_CATEGORIES = new Set(["navigation", "fetch", "xhr"]);

// Only these context blocks are allowed through; everything else (which may
// contain machine- or user-specific data) is stripped.
const SAFE_CONTEXTS = new Set(["os", "app", "device", "runtime", "browser"]);

// Absolute filesystem paths and file:// URLs. We redact rather than send these
// because they leak usernames, directory layouts, and document names.
const FILE_URL = /file:\/\/[^\s"'<>|]+/g;
const WINDOWS_PATH = /[A-Za-z]:\\[^\s"'<>|]+/g;
const POSIX_PATH = /\/(?:Users|home|root|var|tmp|private|mnt|media|opt)\/[^\s"'<>|]+/g;

const REDACTED = "[redacted-path]";

/** Replace any absolute path or file URL in `input` with a placeholder. */
export function redactPaths(input: string): string {
  return input
    .replace(FILE_URL, REDACTED)
    .replace(WINDOWS_PATH, REDACTED)
    .replace(POSIX_PATH, REDACTED);
}

/**
 * Scrub a breadcrumb before it is attached to an event. Drops URL-bearing
 * categories entirely and redacts paths / URLs from anything that remains.
 * Returns `null` to discard the breadcrumb.
 */
export function scrubBreadcrumb(crumb: Breadcrumb): Breadcrumb | null {
  if (crumb.category && URL_BEARING_CATEGORIES.has(crumb.category)) {
    return null;
  }
  if (crumb.message) {
    crumb.message = redactPaths(crumb.message);
  }
  if (crumb.data && typeof crumb.data.url === "string") {
    crumb.data.url = "[redacted-url]";
  }
  return crumb;
}

/**
 * Scrub an error event before it leaves the machine: drop request/user/host
 * data, redact absolute paths from messages and exception values, and keep only
 * an allowlist of context blocks. PII never reaches Sentry.
 */
export function scrubEvent(event: ErrorEvent): ErrorEvent {
  // Request carries the URL + query string; user carries IP / id; server_name
  // is the machine hostname. None of these are useful for a local app.
  event.request = undefined;
  event.user = undefined;
  event.server_name = undefined;

  if (event.message) {
    event.message = redactPaths(event.message);
  }

  for (const exception of event.exception?.values ?? []) {
    if (exception.value) {
      exception.value = redactPaths(exception.value);
    }
  }

  if (event.contexts) {
    for (const key of Object.keys(event.contexts)) {
      if (!SAFE_CONTEXTS.has(key)) {
        delete event.contexts[key];
      }
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(scrubBreadcrumb)
      .filter((crumb): crumb is Breadcrumb => crumb !== null);
  }

  return event;
}

// Reporting only happens in production builds with a DSN present. Dev builds
// (`pnpm tauri dev`) never initialize the SDK, so no events are sent locally.
function reportingAllowed(): boolean {
  return import.meta.env.PROD && SENTRY_DSN.length > 0;
}

/**
 * Turn error reporting on. Mirrors the choice into the Rust backend (which has
 * its own prod gate) and lazily initializes the JS SDK. No-op in dev or if the
 * client is already running.
 */
export function enableTelemetry(): void {
  void invoke("set_error_reporting", { enabled: true }).catch(() => {});

  if (!reportingAllowed() || Sentry.getClient()) {
    return;
  }

  Sentry.init({
    dsn: SENTRY_DSN,
    release: `glyph@${__APP_VERSION__}`,
    // Hard privacy posture for a local-first viewer: no PII, no performance
    // tracing, no session replay (replay would record document contents).
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  });
}

/**
 * Turn error reporting off. Closes the JS client (flushing anything queued) and
 * tells the Rust backend to drop its Sentry guard.
 */
export function disableTelemetry(): void {
  void invoke("set_error_reporting", { enabled: false }).catch(() => {});
  void Sentry.getClient()?.close();
}
