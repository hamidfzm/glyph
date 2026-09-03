import type { TFunction } from "i18next";
import type { SyncError } from "@/lib/sync";

/**
 * Human-readable message for a `SyncError` payload. The Tauri command
 * surface returns the tagged error JSON; the UI usually wants one
 * sentence to show in a toast or inline beneath the form.
 */
export function describeSyncError(err: unknown, t: TFunction<"sync">): string {
  if (!err || typeof err !== "object") return String(err ?? t("error.unknown"));
  const e = err as SyncError;
  switch (e.kind) {
    case "not-configured":
      return t("error.notConfigured");
    case "auth-failed":
      return e.message
        ? t("error.authFailedDetail", { message: String(e.message) })
        : t("error.authFailed");
    case "network":
      return e.message
        ? t("error.networkDetail", { message: String(e.message) })
        : t("error.network");
    case "conflict": {
      const files = Array.isArray(e.message) ? e.message : [];
      return t("error.conflict", { count: files.length });
    }
    case "invalid-state":
      return e.message
        ? t("error.invalidStateDetail", { message: String(e.message) })
        : t("error.invalidState");
    case "invalid-remote-url":
      return t("error.invalidRemoteUrl");
    case "io":
      return e.message ? t("error.ioDetail", { message: String(e.message) }) : t("error.io");
    case "backend":
      return e.message
        ? t("error.backendDetail", { message: String(e.message) })
        : t("error.backend");
    default:
      return t("error.unknown");
  }
}
