// The set of UI locales Glyph ships translations for, plus the pure helpers
// that map a requested locale (a settings override, or the OS/webview tag) to
// one of them. Adding a language means: drop its JSON under src/locales/<code>/,
// register the bundle in src/lib/i18n.ts, and add an entry here.

export const FALLBACK_LOCALE = "en";

export interface LocaleMeta {
  // BCP-47 tag, e.g. "en", "de", "pt-BR", "zh-Hans".
  code: string;
  // English name, for documentation and the ≥80%-complete gate UI.
  name: string;
  // Endonym shown in the language picker (what speakers call their language).
  nativeName: string;
  // Writing direction; drives <html dir>. RTL locales are tracked in #264.
  dir: "ltr" | "rtl";
}

// Order here is the order shown in the picker (after the "System" entry).
export const LOCALES: LocaleMeta[] = [
  { code: "en", name: "English", nativeName: "English", dir: "ltr" },
  { code: "de", name: "German", nativeName: "Deutsch", dir: "ltr" },
];

const SUPPORTED_CODES = LOCALES.map((l) => l.code);

const primarySubtag = (tag: string) => tag.toLowerCase().split("-")[0];

/**
 * Resolve a requested locale to a supported code, walking the BCP-47 fallback
 * chain: an exact match wins, then a primary-subtag match (`de-DE` → `de`,
 * `pt-BR` → `pt`), otherwise English. `null`/empty resolves to the fallback so
 * callers can pass an unresolved OS locale straight through.
 */
export function resolveLocale(requested: string | null | undefined): string {
  if (!requested) return FALLBACK_LOCALE;
  const lower = requested.toLowerCase();

  const exact = SUPPORTED_CODES.find((c) => c.toLowerCase() === lower);
  if (exact) return exact;

  const primary = primarySubtag(requested);
  const byPrimary = SUPPORTED_CODES.find((c) => primarySubtag(c) === primary);
  if (byPrimary) return byPrimary;

  return FALLBACK_LOCALE;
}

/** Writing direction for a supported code; defaults to LTR for unknown codes. */
export function localeDir(code: string): "ltr" | "rtl" {
  return LOCALES.find((l) => l.code === code)?.dir ?? "ltr";
}
