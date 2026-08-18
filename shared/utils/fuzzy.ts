/** Dependency-free fuzzy matching for movie/cinema titles.
 *  Combines normalized token containment, prefix matching and
 *  Damerau–Levenshtein distance so exact, partial and misspelled
 *  queries all resolve. */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Damerau–Levenshtein edit distance (with transpositions). */
export function editDistance(a: string, b: string): number {
  const al = a.length;
  const bl = b.length;
  if (al === 0) return bl;
  if (bl === 0) return al;
  const d: number[][] = Array.from({ length: al + 1 }, () => new Array<number>(bl + 1).fill(0));
  for (let i = 0; i <= al; i++) d[i]![0] = i;
  for (let j = 0; j <= bl; j++) d[0]![j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[al]![bl]!;
}

function tokenSimilarity(qTok: string, tTok: string): number {
  if (qTok === tTok) return 1;
  if (tTok.startsWith(qTok) && qTok.length >= 3) return 0.92;
  const dist = editDistance(qTok, tTok);
  const maxLen = Math.max(qTok.length, tTok.length);
  if (maxLen === 0) return 0;
  const sim = 1 - dist / maxLen;
  // Require reasonable similarity for short tokens to avoid noise.
  if (qTok.length <= 3 && dist > 1) return 0;
  return sim >= 0.6 ? sim * 0.95 : 0;
}

/** Score how well `query` matches `target` in [0,1]. */
export function fuzzyScore(query: string, target: string): number {
  const q = normalize(query);
  const t = normalize(target);
  if (!q || !t) return 0;
  if (q === t) return 1;
  if (t.includes(q)) return 0.95;

  const qTokens = q.split(' ');
  const tTokens = t.split(' ');
  let total = 0;
  for (const qt of qTokens) {
    let best = 0;
    for (const tt of tTokens) best = Math.max(best, tokenSimilarity(qt, tt));
    total += best;
  }
  const coverage = total / qTokens.length;
  // Whole-string fallback for run-together or heavy misspellings.
  const whole = 1 - editDistance(q, t) / Math.max(q.length, t.length);
  return Math.max(coverage * 0.9, whole);
}

export interface FuzzyMatch<T> {
  item: T;
  score: number;
}

/** Rank candidates by fuzzy score against one or more searchable strings. */
export function fuzzySearch<T>(
  query: string,
  items: T[],
  keys: (item: T) => string[],
  threshold = 0.55,
): FuzzyMatch<T>[] {
  const results: FuzzyMatch<T>[] = [];
  for (const item of items) {
    let best = 0;
    for (const key of keys(item)) best = Math.max(best, fuzzyScore(query, key));
    if (best >= threshold) results.push({ item, score: best });
  }
  return results.sort((a, b) => b.score - a.score);
}
