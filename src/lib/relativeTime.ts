import type { TFunction } from "i18next";

/** Coarse "N minutes ago" rendering of a unix timestamp, translated through the
 *  `sync` namespace's `relativeTime.*` keys. Null means "never". */
export function relativeTime(unix: number | null, t: TFunction<"sync">): string {
  if (!unix) return t("relativeTime.never");
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (seconds < 60) return t("relativeTime.secondsAgo", { count: seconds });
  if (seconds < 3600) return t("relativeTime.minutesAgo", { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t("relativeTime.hoursAgo", { count: Math.floor(seconds / 3600) });
  return t("relativeTime.daysAgo", { count: Math.floor(seconds / 86400) });
}
