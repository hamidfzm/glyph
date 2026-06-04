import { getVersion } from "@tauri-apps/api/app";
import { isNewerVersion } from "./version";

// GitHub release endpoints for the published app. The API gives us the latest
// release's tag; the page is the human-facing fallback we open in a browser.
const RELEASES_API = "https://api.github.com/repos/hamidfzm/glyph/releases/latest";
export const RELEASES_PAGE = "https://github.com/hamidfzm/glyph/releases/latest";

export interface AvailableUpdate {
  latestVersion: string;
  currentVersion: string;
  // Direct URL to the release (GitHub's `html_url`), falling back to the
  // generic latest-release page if the payload omits it.
  url: string;
}

// Discriminated result so callers can distinguish "newer release exists" from
// "already up to date" from "check failed" — the banner only reacts to
// `available`, while the settings UI reports all three.
export type UpdateResult =
  | ({ status: "available" } & AvailableUpdate)
  | { status: "current"; currentVersion: string }
  | { status: "error" };

/**
 * Query GitHub for the latest published release and compare it to the running
 * app version.
 *
 * Never throws: any failure (offline, rate limit, malformed payload, missing
 * permission) resolves to `{ status: "error" }`. A failed update check must
 * stay silent — it is a convenience, not a critical path.
 */
export async function checkForUpdate(): Promise<UpdateResult> {
  try {
    const currentVersion = await getVersion();
    const res = await fetch(RELEASES_API, {
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return { status: "error" };

    const data: unknown = await res.json();
    const tag = (data as { tag_name?: unknown }).tag_name;
    if (typeof tag !== "string" || tag.length === 0) return { status: "error" };

    const latestVersion = tag.replace(/^v/, "");
    if (!isNewerVersion(latestVersion, currentVersion)) {
      return { status: "current", currentVersion };
    }

    const htmlUrl = (data as { html_url?: unknown }).html_url;
    const url = typeof htmlUrl === "string" && htmlUrl.length > 0 ? htmlUrl : RELEASES_PAGE;
    return { status: "available", latestVersion, currentVersion, url };
  } catch {
    return { status: "error" };
  }
}
