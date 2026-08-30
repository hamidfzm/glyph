import type { Breadcrumb, ErrorEvent } from "@sentry/react";
import { invoke } from "@tauri-apps/api/core";
import { arch, version as osVersion } from "@tauri-apps/plugin-os";
import { currentPlatform } from "@/lib/platform";
// Single source of truth for the Sentry DSN — `src-tauri/sentry.json`. The Rust
// build script reads the same file (see build.rs) so the frontend and backend
// clients always target the same project. DSNs are public client identifiers,
// not secrets, so committing this is intentional.
// biome-ignore lint/style/noRestrictedImports: lives outside src/, but it is the canonical config
import sentryConfig from "../../src-tauri/sentry.json";

const SENTRY_DSN = sentryConfig.dsn;

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

/**
 * OS identity attached to every event. `scrubEvent` drops `event.request`, so
 * Sentry never sees a User-Agent to infer the platform from and an issue would
 * otherwise carry no clue which OS produced it. The version and architecture
 * come from the OS plugin, which is absent outside a Tauri webview.
 */
function osScope() {
  const name = currentPlatform();
  let version = "";
  let cpu = "";
  try {
    version = osVersion();
    cpu = arch();
  } catch {
    // Plain browser or test environment: the platform tag alone still applies.
  }
  return {
    tags: { platform: name, arch: cpu },
    contexts: { os: { name, version } },
  };
}

// Reporting only happens in production builds with a DSN present. Dev builds
// (`pnpm tauri dev`) never initialize the SDK, so no events are sent locally.
function reportingAllowed(): boolean {
  return import.meta.env.PROD && SENTRY_DSN.length > 0;
}

type SentrySdk = typeof import("@sentry/react");

// The SDK is heavy and only useful in production after the user opts in, so it
// is imported on demand: startup never downloads it, and `captureException`
// stays a no-op until the opt-in has loaded it (uninitialized-SDK semantics).
let sdkPromise: Promise<SentrySdk> | null = null;
let sdk: SentrySdk | null = null;
// Desired state, tracked separately because loading is async: an opt-out that
// lands while the SDK is still downloading must win over the pending init.
let telemetryWanted = false;
// A closed client stays bound in the SDK, so `getClient()` alone cannot tell
// "running" from "opted out"; without this flag a re-enable would be skipped
// and every later capture silently dropped by the closed client.
let clientClosed = false;

function loadSdk(): Promise<SentrySdk> {
  sdkPromise ??= import("@sentry/react").then((mod) => {
    sdk = mod;
    return mod;
  });
  return sdkPromise;
}

/**
 * Turn error reporting on. Mirrors the choice into the Rust backend (which has
 * its own prod gate) and lazily loads + initializes the JS SDK. No-op in dev
 * or if the client is already running. The returned promise resolves once the
 * SDK is ready (or immediately when reporting is off); callers may ignore it.
 */
export function enableTelemetry(): Promise<void> {
  telemetryWanted = true;
  void invoke("set_error_reporting", { enabled: true }).catch(() => {});

  if (!reportingAllowed()) {
    return Promise.resolve();
  }

  return loadSdk().then((Sentry) => {
    if (!telemetryWanted || (Sentry.getClient() && !clientClosed)) {
      return;
    }
    clientClosed = false;
    Sentry.init({
      dsn: SENTRY_DSN,
      release: `glyph@${__APP_VERSION__}`,
      initialScope: osScope(),
      // Hard privacy posture for a local-first viewer: no PII, no performance
      // tracing, no session replay (replay would record document contents).
      sendDefaultPii: false,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
      beforeBreadcrumb: scrubBreadcrumb,
    });
  });
}

/**
 * Turn error reporting off. Closes the JS client (flushing anything queued) and
 * tells the Rust backend to drop its Sentry guard.
 */
export function disableTelemetry(): void {
  telemetryWanted = false;
  void invoke("set_error_reporting", { enabled: false }).catch(() => {});
  const client = sdk?.getClient();
  if (client) {
    void client.close();
    clientClosed = true;
  }
}

/**
 * Report an error to Sentry if the telemetry opt-in has loaded the SDK.
 * Callers use this instead of importing `@sentry/react`, which would drag the
 * SDK into the startup bundle.
 */
export function captureException(
  error: unknown,
  hint?: Parameters<SentrySdk["captureException"]>[1],
): void {
  sdk?.captureException(error, hint);
}
