// RTL Unicode blocks: Hebrew, Arabic, Syriac, Thaana, NKo, Samaritan, Mandaic,
// Arabic Extended, and the Arabic/Hebrew presentation forms.
const RTL_CHAR = /[֐-߿ࡠ-ࣿיִ-﷽ﹰ-ﻼ]/;

/**
 * Whether text reads right-to-left, decided by its first letter (the same
 * first-strong-character heuristic as HTML's `dir="auto"`). Digits,
 * punctuation, and whitespace are skipped; text with no letters resolves LTR.
 */
export function isRtlText(text: string | null | undefined): boolean {
  const first = text?.match(/\p{L}/u);
  return first ? RTL_CHAR.test(first[0]) : false;
}
