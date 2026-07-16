// Script identification for spell check: a word is only checked against
// dictionaries that cover its script, and skipped entirely when no enabled
// dictionary does. This is what keeps mixed-language documents quiet: Persian
// text under an English-only setup is skipped, not flagged.

export type WordScript =
  | "latin"
  | "arabic"
  | "cyrillic"
  | "greek"
  | "hebrew"
  | "han"
  | "hangul"
  | "kana"
  | "devanagari"
  | "thai"
  | "other";

// Ordered probes; a word's script is decided by its first letter. Mixed-script
// words are rare and follow their leading character.
const SCRIPT_PROBES: readonly [WordScript, RegExp][] = [
  ["latin", /^\p{Script=Latin}/u],
  ["arabic", /^\p{Script=Arabic}/u],
  ["cyrillic", /^\p{Script=Cyrillic}/u],
  ["greek", /^\p{Script=Greek}/u],
  ["hebrew", /^\p{Script=Hebrew}/u],
  ["han", /^\p{Script=Han}/u],
  ["hangul", /^\p{Script=Hangul}/u],
  ["kana", /^(?:\p{Script=Hiragana}|\p{Script=Katakana})/u],
  ["devanagari", /^\p{Script=Devanagari}/u],
  ["thai", /^\p{Script=Thai}/u],
];

export function wordScript(word: string): WordScript {
  for (const [script, probe] of SCRIPT_PROBES) {
    if (probe.test(word)) return script;
  }
  return "other";
}

// Primary script per language code, for dictionaries that do not declare their
// own coverage. Keyed by the lowercased primary subtag ("fa" in "fa-IR").
const LANGUAGE_SCRIPTS: Record<string, readonly WordScript[]> = {
  ar: ["arabic"],
  fa: ["arabic"],
  ur: ["arabic"],
  ps: ["arabic"],
  ru: ["cyrillic"],
  uk: ["cyrillic"],
  bg: ["cyrillic"],
  sr: ["cyrillic"],
  el: ["greek"],
  he: ["hebrew"],
  yi: ["hebrew"],
  zh: ["han"],
  ja: ["kana", "han"],
  ko: ["hangul"],
  hi: ["devanagari"],
  mr: ["devanagari"],
  ne: ["devanagari"],
  th: ["thai"],
};

/**
 * The scripts a dictionary for `language` covers when the contribution does
 * not declare its own. Unknown codes default to Latin, the script of every
 * language the built-in pipeline has shipped so far.
 */
export function scriptsForLanguage(language: string): readonly WordScript[] {
  const primary = language.toLowerCase().split(/[-_]/)[0];
  return LANGUAGE_SCRIPTS[primary] ?? ["latin"];
}
