/**
 * Prompt registry — stores and queries evaluation prompts.
 */

import type { CapabilityDimension } from "../model/types";
import type { EvalPrompt, EvalDomain, EvalDifficulty } from "./types";
import { validatePrompt } from "./types";

/**
 * Filter criteria for prompt queries.
 */
export interface PromptFilter {
  domain?: EvalDomain;
  difficulty?: EvalDifficulty;
  dimension?: CapabilityDimension;
  verifiableOnly?: boolean;
  minComplexity?: number;
}

/**
 * Domain coverage statistics.
 */
export interface DomainStats {
  domain: EvalDomain;
  count: number;
  byDifficulty: Record<EvalDifficulty, number>;
}

/**
 * In-memory prompt registry with filtering support.
 */
export class PromptRegistry {
  private readonly prompts = new Map<string, EvalPrompt>();

  /** Register a prompt. Throws on duplicate id or invalid prompt. */
  register(prompt: EvalPrompt): void {
    const error = validatePrompt(prompt);
    if (error) throw new Error(`Invalid prompt "${prompt.id}": ${error}`);
    if (this.prompts.has(prompt.id))
      throw new Error(`Duplicate prompt id: ${prompt.id}`);
    this.prompts.set(prompt.id, prompt);
  }

  /** Register multiple prompts at once. */
  registerAll(prompts: EvalPrompt[]): void {
    for (const p of prompts) this.register(p);
  }

  /** Get a prompt by id. */
  get(id: string): EvalPrompt | undefined {
    return this.prompts.get(id);
  }

  /** Total number of registered prompts. */
  get size(): number {
    return this.prompts.size;
  }

  /** Get all prompts matching a filter. */
  query(filter: PromptFilter = {}): EvalPrompt[] {
    let results = Array.from(this.prompts.values());

    if (filter.domain) {
      results = results.filter((p) => p.domain === filter.domain);
    }
    if (filter.difficulty) {
      results = results.filter((p) => p.difficulty === filter.difficulty);
    }
    if (filter.dimension) {
      results = results.filter((p) =>
        p.expectedDimensions.includes(filter.dimension!),
      );
    }
    if (filter.verifiableOnly) {
      results = results.filter((p) => p.verifiable);
    }
    if (filter.minComplexity !== undefined) {
      results = results.filter(
        (p) => p.criteria.complexity >= filter.minComplexity!,
      );
    }

    return results;
  }

  /** Get all registered prompts. */
  all(): EvalPrompt[] {
    return Array.from(this.prompts.values());
  }

  /** Get dimension coverage — which dimensions have prompts. */
  dimensionCoverage(): Set<CapabilityDimension> {
    const covered = new Set<CapabilityDimension>();
    for (const p of this.prompts.values()) {
      for (const d of p.expectedDimensions) {
        covered.add(d);
      }
    }
    return covered;
  }

  /** Get per-domain statistics. */
  domainStats(): DomainStats[] {
    const stats = new Map<
      EvalDomain,
      { count: number; byDifficulty: Record<EvalDifficulty, number> }
    >();

    for (const p of this.prompts.values()) {
      if (!stats.has(p.domain)) {
        stats.set(p.domain, {
          count: 0,
          byDifficulty: { simple: 0, moderate: 0, complex: 0 },
        });
      }
      const s = stats.get(p.domain)!;
      s.count++;
      s.byDifficulty[p.difficulty]++;
    }

    return Array.from(stats.entries()).map(([domain, s]) => ({
      domain,
      ...s,
    }));
  }
}
