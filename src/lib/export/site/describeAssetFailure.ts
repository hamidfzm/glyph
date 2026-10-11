// Controls, format characters (text-direction overrides among them) and line
// separators: the name comes from a note, and the line reaches a terminal.
const UNPRINTABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** One failed copy as a line for a report: the site path, quoted, then why. */
export function describeAssetFailure(rel: string, reason: string): string {
  const line = `${JSON.stringify(rel)}: ${reason}`;
  return line.replace(UNPRINTABLE, (char) => `\\u{${char.codePointAt(0)?.toString(16)}}`);
}
