/**
 * AbSplitter — A/B test splitter for selector evaluation.
 *
 * Wraps two selectors, randomly routing requests to one or the other
 * based on a configurable split fraction. Tags the plan reason with
 * [A] or [B] for trace analysis.
 */

import type { Selector } from "../axis/interfaces";
import type {
  AxisTaskRequirement,
  ModelScore,
  BudgetConfig,
  EnsemblePlan,
} from "../axis/types";

export interface AbSplitterOpts {
  selectorA: Selector;
  selectorB: Selector;
  /** Fraction of traffic routed to B. Default: 0.5. */
  bFraction?: number;
  /** Custom random function for deterministic testing. */
  randomFn?: () => number;
}

export class AbSplitter implements Selector {
  private readonly selectorA: Selector;
  private readonly selectorB: Selector;
  private readonly bFraction: number;
  private readonly randomFn: () => number;

  constructor(opts: AbSplitterOpts) {
    this.selectorA = opts.selectorA;
    this.selectorB = opts.selectorB;
    this.bFraction = opts.bFraction ?? 0.5;
    this.randomFn = opts.randomFn ?? Math.random;
  }

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const useB = this.randomFn() < this.bFraction;
    const selector = useB ? this.selectorB : this.selectorA;
    const group = useB ? "B" : "A";

    const plan = await selector.select(req, scores, budget);

    return {
      ...plan,
      reason: `[${group}] ${plan.reason}`,
    };
  }
}
