/**
 * Evidence overlap — Jaccard similarity over citation tokens extracted
 * from worker responses. Component of the Aragora convergence score
 * (synaptent/aragora docs/algorithms/CONVERGENCE.md).
 *
 * Recognizes: URLs, arXiv ids, venue+year tags (ACL 2023, NeurIPS 2023, etc.).
 * Cheap heuristic: doesn't validate citations, only counts shared mentions.
 *
 * @module quality/evidence-overlap
 */

const URL_RE = /https?:\/\/[^\s)\]]+/gi;
const ARXIV_RE = /arxiv[:\s]*(\d{4}\.\d{4,5})/gi;
const VENUE_RE = /\b(ACL|NeurIPS|ICML|ICLR|EMNLP|NAACL|AAAI|IJCAI|CVPR|ECCV|KDD|SIGDIAL|COMMA)\s+(\d{4})\b/gi;

/**
 * Extract a normalized set of evidence tokens from a single response text.
 */
export function extractEvidenceTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.matchAll(URL_RE)) tokens.add(m[0].toLowerCase());
  for (const m of text.matchAll(ARXIV_RE)) tokens.add(`arxiv:${m[1]}`);
  for (const m of text.matchAll(VENUE_RE)) tokens.add(`${m[1]!.toLowerCase()}:${m[2]}`);
  return tokens;
}

/**
 * Compute average pairwise Jaccard similarity of evidence sets across responses.
 * 0 when fewer than 2 responses, or when no evidence found in any response.
 * 1.0 when every pair shares the exact same set.
 */
export function computeEvidenceOverlap(responses: readonly string[]): number {
  if (responses.length < 2) return 0;
  const sets = responses.map(extractEvidenceTokens);
  if (sets.every((s) => s.size === 0)) return 0;

  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      const a = sets[i]!;
      const b = sets[j]!;
      const union = new Set([...a, ...b]);
      if (union.size === 0) continue;
      let intersect = 0;
      for (const x of a) if (b.has(x)) intersect++;
      sum += intersect / union.size;
      pairs++;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}
