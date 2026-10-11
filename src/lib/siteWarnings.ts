// Kept out of `src/lib/export/`, which loads lazily: the export hooks import this at startup.
import type { ExportSiteResult } from "@/lib/export/site/exportSite";

/**
 * Something a website export that finished still has to report (INV-7).
 * `reason` is what the export reported, shown as written (it is not
 * translated).
 */
export type SiteWarning =
  | {
      kind: "assetsFailed";
      /** The first file that could not be copied, and why. */
      reason: string;
      /** How many more could not be copied either. */
      more: number;
    }
  | { kind: "pruneFailed"; reason: string };

/** What a finished export fell short on, the files its pages use first. */
export function siteWarnings({
  failedAssets,
  pruneError,
}: Pick<ExportSiteResult, "failedAssets" | "pruneError">): SiteWarning[] {
  const warnings: SiteWarning[] = [];
  const [firstAsset, ...otherAssets] = failedAssets;
  if (firstAsset !== undefined) {
    warnings.push({ kind: "assetsFailed", reason: firstAsset, more: otherAssets.length });
  }
  if (pruneError !== null) warnings.push({ kind: "pruneFailed", reason: pruneError });
  return warnings;
}

const CONSEQUENCE = {
  assetsFailed:
    "some files the pages use could not be copied, so those pages may show a missing or outdated image, media file or download",
  pruneFailed:
    "the cleanup after the export did not finish, so outdated pages may be left in the folder, now or after a later export",
} as const;

/** The stderr line `glyph export` and `glyph serve` print for a warning. */
export function warningLine(warning: SiteWarning): string {
  const line = `Warning: ${CONSEQUENCE[warning.kind]}: ${warning.reason}`;
  if (warning.kind !== "assetsFailed" || warning.more === 0) return line;
  return `${line} (${warning.more} more could not be copied either)`;
}
