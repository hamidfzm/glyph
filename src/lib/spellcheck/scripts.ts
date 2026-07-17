// Script coverage for spell check: a word is only checked against dictionaries
// covering its script, and skipped entirely when no enabled dictionary does.
// This is what keeps mixed-language documents quiet: Persian text under an
// English-only setup is skipped, not flagged.
//
// Both halves are driven by the engine's own Unicode/CLDR data rather than a
// hand-maintained list, so every script Unicode knows is supported: language
// codes resolve through Intl.Locale's likely-subtags, and coverage tests are
// dynamic `\p{Script=...}` probes (the regex engine accepts ISO 15924 codes).

// ISO 15924 composite codes that are not Unicode Script property values,
// expanded to the scripts they consist of.
const COMPOSITE_SCRIPTS: Record<string, readonly string[]> = {
  Jpan: ["Hira", "Kana", "Hani"],
  Kore: ["Hang", "Hani"],
  Hans: ["Hani"],
  Hant: ["Hani"],
};

/**
 * The ISO 15924 script code(s) a dictionary for `language` covers when the
 * contribution does not declare its own, from the engine's likely-subtags
 * data (e.g. "fa" resolves to Arab, "ja" to Jpan). Accepts both BCP-47 and
 * POSIX-style codes ("fa_IR"); unresolvable ones default to Latn.
 */
export function scriptsForLanguage(language: string): readonly string[] {
  let script: string | undefined;
  try {
    // Hunspell dictionaries commonly name languages POSIX-style (fa_IR), which
    // the BCP-47 parser rejects outright.
    script = new Intl.Locale(language.replaceAll("_", "-")).maximize().script;
  } catch {
    // fall through to the Latn default
  }
  return [script ?? "Latn"];
}

// ISO 15924 codes are four letters, Titlecase (Arab, Latn); accept any casing
// from plugin manifests. Longer Unicode script names pass through unchanged.
function canonicalScript(script: string): string {
  if (!/^[A-Za-z]{4}$/.test(script)) return script;
  return script[0].toUpperCase() + script.slice(1).toLowerCase();
}

/**
 * A predicate telling whether a word (by its first letter) belongs to any of
 * the given scripts. This is the one seam every scripts list flows through:
 * casing is canonicalized, composite codes are expanded, and a name the regex
 * engine does not know is warned about and contributes no coverage.
 */
export function scriptCoverage(scripts: readonly string[]): (word: string) => boolean {
  const probes: RegExp[] = [];
  const expanded = scripts
    .map(canonicalScript)
    .flatMap((script) => COMPOSITE_SCRIPTS[script] ?? [script]);
  for (const script of expanded) {
    // Only plain names reach the regex, so a crafted "Latn}|." cannot break
    // out of the \p{...} class and claim coverage of everything.
    if (/^[A-Za-z_]+$/.test(script)) {
      try {
        probes.push(new RegExp(`^\\p{Script=${script}}`, "u"));
        continue;
      } catch {
        // fall through to the warning
      }
    }
    console.warn(`Spell check: unknown script "${script}" contributes no coverage`);
  }
  return (word) => probes.some((probe) => probe.test(word));
}
