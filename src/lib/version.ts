/**
 * Compare two dotted version strings (e.g. "1.2.0"). Returns true when
 * `candidate` is strictly newer than `current`.
 *
 * Only the leading numeric components matter: each segment is parsed with
 * `parseInt`, so a pre-release suffix like "1.2.0-beta" is treated as "1.2.0",
 * and a non-numeric segment counts as 0. Missing trailing components also count
 * as 0, so "1.2" === "1.2.0" and "1.2" < "1.2.1". Comparison is numeric, not
 * lexical, so "1.10.0" is correctly newer than "1.9.0".
 */
export function isNewerVersion(candidate: string, current: string): boolean {
  const parse = (v: string): number[] =>
    v.split(".").map((part) => {
      const n = Number.parseInt(part, 10);
      return Number.isNaN(n) ? 0 : n;
    });

  const a = parse(candidate);
  const b = parse(current);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}
