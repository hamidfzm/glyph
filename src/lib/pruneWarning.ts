// Kept out of `src/lib/export/`, which loads lazily: the CLI hooks import this at startup.

/** The stderr line `glyph export` and `glyph serve` print when a site was built but its cleanup failed. */
export function pruneWarning(reason: string): string {
  return `Warning: the cleanup after the export did not finish, so outdated pages may be left in the folder, now or after a later export: ${reason}`;
}
