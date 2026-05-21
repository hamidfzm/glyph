// Subsequence fuzzy matcher used by the command palette.
//
// Given a query, returns the best score against a candidate string plus the
// matched character indices (for inline highlighting). Returns null when the
// query doesn't appear as a subsequence at all.
//
// Scoring favors:
// - exact prefix
// - matches at word boundaries (start of token after a separator or camelCase)
// - consecutive matched characters
// - shorter candidates over longer ones with the same matches

export interface FuzzyResult {
  score: number;
  indices: number[];
}

const SEPARATORS = /[\s_\-/\\.]/;

function isSeparator(ch: string): boolean {
  return SEPARATORS.test(ch);
}

function isWordStart(target: string, i: number): boolean {
  if (i === 0) return true;
  const prev = target[i - 1];
  const curr = target[i];
  if (isSeparator(prev)) return true;
  // camelCase boundary: previous lowercase, current uppercase
  if (prev === prev.toLowerCase() && curr !== curr.toLowerCase() && prev !== curr) return true;
  return false;
}

/**
 * Score the best match of `query` as a subsequence of `target`. Case-insensitive.
 * Returns null if at least one query character can't be matched in order.
 */
export function fuzzyMatch(query: string, target: string): FuzzyResult | null {
  if (query.length === 0) return { score: 0, indices: [] };
  if (target.length === 0) return null;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Quick reject: query longer than target.
  if (q.length > t.length) return null;

  // Greedy subsequence match with bonus scoring; backtracks via DP over
  // (qIdx, tIdx) only for sensible lengths. For longer strings we fall back to
  // the greedy result which is good enough in practice for command lists.
  const MAX_DP = 256;
  if (q.length * t.length <= MAX_DP * MAX_DP) {
    return bestMatchDp(q, t, target);
  }
  return greedyMatch(q, t, target);
}

function bestMatchDp(q: string, t: string, original: string): FuzzyResult | null {
  // dp[qi][ti] = { score, prev_ti } for matching q[0..qi] ending at t[ti].
  // We track only the best score per (qi, ti) and reconstruct indices afterward.
  const m = q.length;
  const n = t.length;
  const NEG = Number.NEGATIVE_INFINITY;
  const score: Float64Array = new Float64Array(m * n);
  const prev: Int32Array = new Int32Array(m * n);
  for (let i = 0; i < m * n; i++) {
    score[i] = NEG;
    prev[i] = -1;
  }

  for (let ti = 0; ti < n; ti++) {
    if (q[0] !== t[ti]) continue;
    score[ti] = charScore(original, ti, /*consecutive*/ false);
  }

  for (let qi = 1; qi < m; qi++) {
    for (let ti = qi; ti < n; ti++) {
      if (q[qi] !== t[ti]) continue;
      let best = NEG;
      let bestPrev = -1;
      for (let prevTi = qi - 1; prevTi < ti; prevTi++) {
        const s = score[(qi - 1) * n + prevTi];
        if (s === NEG) continue;
        const consecutive = prevTi === ti - 1;
        const candidate = s + charScore(original, ti, consecutive);
        if (candidate > best) {
          best = candidate;
          bestPrev = prevTi;
        }
      }
      if (best > NEG) {
        score[qi * n + ti] = best;
        prev[qi * n + ti] = bestPrev;
      }
    }
  }

  // Find the best ending column for the last query char.
  let bestEnd = -1;
  let bestScore = NEG;
  for (let ti = m - 1; ti < n; ti++) {
    const s = score[(m - 1) * n + ti];
    if (s > bestScore) {
      bestScore = s;
      bestEnd = ti;
    }
  }
  if (bestEnd < 0 || bestScore === NEG) return null;

  const indices: number[] = new Array(m);
  let cur = bestEnd;
  for (let qi = m - 1; qi >= 0; qi--) {
    indices[qi] = cur;
    cur = prev[qi * n + cur];
  }

  // Slight length-aware penalty so the same matches in a shorter target rank
  // higher than in a longer one.
  return { score: bestScore - n * 0.01, indices };
}

function greedyMatch(q: string, t: string, original: string): FuzzyResult | null {
  let qi = 0;
  let lastMatch = -2;
  let score = 0;
  const indices: number[] = [];
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (q[qi] !== t[ti]) continue;
    const consecutive = ti === lastMatch + 1;
    score += charScore(original, ti, consecutive);
    indices.push(ti);
    lastMatch = ti;
    qi++;
  }
  if (qi < q.length) return null;
  return { score: score - t.length * 0.01, indices };
}

function charScore(original: string, i: number, consecutive: boolean): number {
  let s = 1;
  if (i === 0) s += 4; // prefix match
  if (isWordStart(original, i)) s += 2;
  if (consecutive) s += 3;
  return s;
}
