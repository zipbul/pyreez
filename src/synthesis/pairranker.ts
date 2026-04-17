/**
 * PairRanker — pairwise LLM judging of candidate responses.
 *
 * Pattern from LLM-Blender (Jiang et al., ACL 2023, arXiv 2306.02561):
 * each pair of candidates is judged by an LLM; candidates are ranked by
 * win count. Reduces synthesis-host burden by surfacing which worker
 * response is strongest before the host writes the final synthesis.
 *
 * Cost: N*(N-1)/2 LLM calls for N candidates. Practical up to N≈7.
 *
 * @module synthesis/pairranker
 */

export interface Candidate {
  readonly id: string;
  readonly content: string;
}

export interface RankedCandidate {
  readonly id: string;
  readonly wins: number;
  readonly losses: number;
}

export interface RankResult {
  readonly ranking: readonly RankedCandidate[];
}

/**
 * Judge function: given a task and two candidates, return "A" (first wins),
 * "B" (second wins), or anything else (treated as a tie).
 *
 * Implementations should be deterministic per call but may be non-deterministic
 * across calls (LLM stochasticity is acceptable).
 */
export type JudgeFn = (task: string, a: Candidate, b: Candidate) => Promise<string>;

/**
 * Rank candidates by pairwise comparison.
 * Stable: when two candidates have equal win counts, original order is preserved.
 */
export async function rankByPairwise(
  task: string,
  candidates: readonly Candidate[],
  judge: JudgeFn,
): Promise<RankResult> {
  if (candidates.length === 0) return { ranking: [] };
  if (candidates.length === 1) {
    return { ranking: [{ id: candidates[0]!.id, wins: 0, losses: 0 }] };
  }

  const wins = new Map<string, number>();
  const losses = new Map<string, number>();
  for (const c of candidates) {
    wins.set(c.id, 0);
    losses.set(c.id, 0);
  }

  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const verdict = (await judge(task, a, b)).trim().toUpperCase();
      if (verdict === "A") {
        wins.set(a.id, wins.get(a.id)! + 1);
        losses.set(b.id, losses.get(b.id)! + 1);
      } else if (verdict === "B") {
        wins.set(b.id, wins.get(b.id)! + 1);
        losses.set(a.id, losses.get(a.id)! + 1);
      }
      // Anything else: tie. No win for either.
    }
  }

  // Pair candidates with their original index for stable sort
  const indexed = candidates.map((c, i) => ({
    id: c.id,
    wins: wins.get(c.id)!,
    losses: losses.get(c.id)!,
    originalIndex: i,
  }));

  indexed.sort((x, y) => {
    if (y.wins !== x.wins) return y.wins - x.wins;
    return x.originalIndex - y.originalIndex;
  });

  return {
    ranking: indexed.map((r) => ({ id: r.id, wins: r.wins, losses: r.losses })),
  };
}
