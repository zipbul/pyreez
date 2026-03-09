/**
 * Axis wrapper classes — adapts existing implementations to pipeline interfaces.
 *
 * Fixed pipeline (no variants):
 * - BtScoringSystem — Bradley-Terry 21-dimension scoring
 * - DomainOverrideProfiler — domain → capability weight lookup
 * - TwoTrackCeSelector — hard filter + composite score + cost-efficiency
 * - RoleBasedProtocol — Producer → Reviewer → Leader deliberation
 */

import type { ClassifyResult, TaskDomain, TaskType } from "../classify/types";
import { profileTask } from "../profile/profiler";
import type { CapabilityRequirement } from "../profile/types";
import type { TaskRequirement } from "../profile/types";
import { ModelRegistry } from "../model/registry";
import type { CapabilityDimension, ModelInfo } from "../model/types";
import { SIGMA_BASE, OPERATIONAL_DIM_NAMES } from "../model/types";
import {
  extractRatingsMap,
  persistRatings,
  type PersistIO,
} from "../model/calibration";
import {
  updateRating as btUpdateRating,
  getRating as btGetRating,
  setRating as btSetRating,
  MU_FLOOR_RATIO,
} from "../evaluation/bt-updater";
import type { PairwiseOutcome } from "../evaluation/types";
import type { ChatMessage } from "../llm/types";
import { deliberate as defaultDeliberateFn } from "../deliberation/engine";
import type { ChatResult, EngineDeps, EngineConfig, RetryDeps } from "../deliberation/engine";
import type { DeliberateOutput } from "../deliberation/types";
import {
  buildWorkerMessages,
  buildLeaderMessages,
  buildDebateWorkerMessages,
} from "../deliberation/prompts";
import type {
  TeamComposition,
  TeamMember,
  ConsensusMode,
  DeliberateInput,
} from "../deliberation/types";
import {
  estimateStaticCost,
  estimateEffectiveCost,
} from "../cost/effective-cost";
import { computeWeightedThompson, MIN_CONFIDENCE, poolCostEfficiency } from "../router/composite-score";
import type { RoutingConfig } from "../config";

import type {
  TaskClassification,
  AxisTaskRequirement,
  EnsemblePlan,
  ModelScore,
  BudgetConfig,
  PairwiseResult,
  DeliberationResult,
  ChatFn,
} from "./types";
import type {
  ScoringSystem,
  Profiler,
  Selector,
  DeliberationProtocol,
  DeliberationOverrides,
} from "./interfaces";

// -- Shared registry (lazy singleton) --

let _registry: ModelRegistry | null = null;
function getRegistry(): ModelRegistry {
  if (!_registry) _registry = new ModelRegistry();
  return _registry;
}

/** Operational dimensions excluded from overall quality score. */
const OPERATIONAL_DIMS = OPERATIONAL_DIM_NAMES;

/** Criticality → quality/cost weight defaults. Used by selectors when no user override. */
const CRITICALITY_WEIGHTS: Record<string, { qw: number; cw: number }> = {
  low: { qw: 0.5, cw: 0.5 },
  medium: { qw: 0.7, cw: 0.3 },
  high: { qw: 0.85, cw: 0.15 },
};

/** Compute overall composite score from capability dimension mu values (excludes operational metrics). */
function computeOverall(dimensions: Record<string, { mu: number; sigma: number }>): number {
  const entries = Object.entries(dimensions)
    .filter(([dim]) => !OPERATIONAL_DIMS.has(dim))
    .map(([, v]) => v);
  if (entries.length === 0) return 0;
  return entries.reduce((sum, d) => sum + d.mu, 0) / entries.length;
}

// Role assignment removed — Selector only picks models.
// DivergeSynthProtocol.buildAutoTeam() assigns leader based on JUDGMENT composite.

// ============================================================
// BtScoringSystem — Bradley-Terry 21-dimension scoring
// ============================================================

export class BtScoringSystem implements ScoringSystem {
  private readonly persistIO?: PersistIO;
  private readonly scoresPath: string;
  private readonly registry: ModelRegistry;

  constructor(opts?: { persistIO?: PersistIO; scoresPath?: string; registry?: ModelRegistry }) {
    this.persistIO = opts?.persistIO;
    this.scoresPath = opts?.scoresPath ?? "scores/models.json";
    this.registry = opts?.registry ?? getRegistry();
  }

  async getScores(modelIds: string[]): Promise<ModelScore[]> {
    const registry = this.registry;
    const results: ModelScore[] = [];

    for (const id of modelIds) {
      const model = registry.getById(id);
      if (!model) continue;

      const dimensions: Record<string, { mu: number; sigma: number }> = {};
      for (const [dim, rating] of Object.entries(model.capabilities)) {
        dimensions[dim] = { mu: rating.mu, sigma: rating.sigma };
      }

      results.push({
        modelId: id,
        dimensions,
        overall: computeOverall(dimensions),
      });
    }

    return results;
  }

  async update(results: PairwiseResult[]): Promise<void> {
    if (results.length === 0) return;

    const VALID_OUTCOMES: string[] = ["A>>B", "A>B", "A=B", "B>A", "B>>A"];
    const registry = this.registry;
    const models = registry.getAll();
    const ratings = extractRatingsMap(models);

    // Compute bootstrap μ floors: for each model×dim, floor = bootstrap_μ × MU_FLOOR_RATIO.
    // Bootstrap μ is the original μ when comparisons === 0, or the current μ as fallback.
    const bootstrapFloors = new Map<string, Map<string, number>>();
    for (const model of models) {
      const dimFloors = new Map<string, number>();
      for (const [dim, rating] of Object.entries(model.capabilities)) {
        dimFloors.set(dim, rating.mu * MU_FLOOR_RATIO);
      }
      bootstrapFloors.set(model.id, dimFloors);
    }

    for (const r of results) {
      if (!VALID_OUTCOMES.includes(r.outcome)) continue;

      const dim = r.dimension as CapabilityDimension;
      const rA = btGetRating(ratings, r.modelAId, dim);
      const rB = btGetRating(ratings, r.modelBId, dim);
      const floorA = bootstrapFloors.get(r.modelAId)?.get(dim) ?? 0;
      const floorB = bootstrapFloors.get(r.modelBId)?.get(dim) ?? 0;
      const { updatedA, updatedB } = btUpdateRating(rA, rB, r.outcome as PairwiseOutcome, floorA, floorB);
      btSetRating(ratings, r.modelAId, dim, updatedA);
      btSetRating(ratings, r.modelBId, dim, updatedB);
    }

    if (this.persistIO) {
      await persistRatings(this.scoresPath, ratings, this.persistIO);
    }
  }
}

// ============================================================
// DomainOverrideProfiler — domain → capability weight lookup
// ============================================================

export class DomainOverrideProfiler implements Profiler {
  async profile(input: TaskClassification): Promise<AxisTaskRequirement> {
    const classifyResult: ClassifyResult = {
      domain: input.domain as TaskDomain,
      taskType: input.taskType as TaskType,
      complexity: input.complexity,
      criticality: (input.criticality ?? "medium") as ClassifyResult["criticality"],
      method: "hint",
    };

    const promptHint = input.language === "ko" ? "한국어 작업" : "";
    const profile: TaskRequirement = profileTask(classifyResult, promptHint);

    const capabilities: Record<string, number> = {};
    for (const cap of profile.requiredCapabilities as CapabilityRequirement[]) {
      capabilities[cap.dimension] = cap.weight;
    }

    return {
      capabilities,
      constraints: {
        minContextWindow: undefined,
        requiresToolCalling: profile.requiresToolCalling,
        requiresKorean: profile.requiresKorean,
        structuredOutput: profile.requiresStructuredOutput,
      },
      budget: {
        qualityWeight: input.qualityWeight,
        costWeight: input.costWeight,
      },
      domain: input.domain,
      taskType: input.taskType,
      criticality: profile.criticality,
      estimatedInputTokens: profile.estimatedInputTokens,
      estimatedOutputTokens: profile.estimatedOutputTokens,
    };
  }
}

// ============================================================
// TwoTrackCeSelector — hard filter + composite score + cost-efficiency
// ============================================================

export class TwoTrackCeSelector implements Selector {
  private readonly registry: ModelRegistry;
  private readonly weights: RoutingConfig;
  private latencyMap?: Map<string, number>;

  constructor(ensembleSize?: number, registry?: ModelRegistry, weights?: RoutingConfig, latencyMap?: Map<string, number>);
  constructor(
    private readonly ensembleSize: number = 1,
    registry?: ModelRegistry,
    weights?: RoutingConfig,
    latencyMap?: Map<string, number>,
  ) {
    this.registry = registry ?? getRegistry();
    this.weights = weights ?? { qualityWeight: 0.7, costWeight: 0.3 };
    this.latencyMap = latencyMap;
  }

  /** Update latency data (called periodically from index.ts). */
  setLatencyMap(map: Map<string, number>): void {
    this.latencyMap = map;
  }

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = this.registry;

    // Constraint-based pre-filtering
    let filteredScores = scores.filter((s) => {
      const info = registry.getById(s.modelId);
      if (!info) return false;
      if (req.constraints.minContextWindow && info.contextWindow < req.constraints.minContextWindow) return false;
      if (req.constraints.requiresToolCalling && !info.supportsToolCalling) return false;
      return true;
    });
    // Soft fallback: if constraints filter everything, use all scores with warning
    if (filteredScores.length === 0) {
      console.warn(
        "TwoTrackCeSelector: all models filtered by constraints (contextWindow=%d, toolCalling=%s), falling back to unfiltered set",
        req.constraints.minContextWindow ?? 0,
        req.constraints.requiresToolCalling ?? false,
      );
      filteredScores = scores;
    }

    // Priority: user per-request > criticality-based (when set) > config file
    const critW = req.criticality ? CRITICALITY_WEIGHTS[req.criticality] : undefined;
    const qw = req.budget.qualityWeight ?? critW?.qw ?? this.weights.qualityWeight;
    const cw = req.budget.costWeight ?? critW?.cw ?? this.weights.costWeight;

    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;
    const take = Math.max(1, this.ensembleSize);

    type Ranked = {
      modelId: string;
      weighted: number;
      cost: number;
      avgSigma: number;
      info: ModelInfo;
    };
    let ranked: Ranked[] = [];

    const useThompson = (this.weights.exploration ?? "thompson") === "thompson";

    for (const ms of filteredScores) {
      const info = registry.getById(ms.modelId);
      if (!info) continue;

      const cost = estimateStaticCost(info, inputTokens, outputTokens);

      let weighted: number;
      if (useThompson) {
        weighted = computeWeightedThompson(ms, req.capabilities);
      } else {
        weighted = 0;
        const capEntries = Object.entries(req.capabilities);
        if (capEntries.length > 0) {
          for (const [dim, weight] of capEntries) {
            const d = ms.dimensions[dim];
            const mu = d?.mu ?? ms.overall;
            const confidence = d
              ? Math.max(MIN_CONFIDENCE, 1 - d.sigma / SIGMA_BASE)
              : MIN_CONFIDENCE;
            weighted += mu * confidence * weight;
          }
        } else {
          weighted = ms.overall;
        }
      }

      // Average sigma for exploration
      const sigmaValues = Object.values(ms.dimensions).map((d) => d.sigma);
      const avgSigma = sigmaValues.length > 0
        ? sigmaValues.reduce((a, b) => a + b, 0) / sigmaValues.length
        : SIGMA_BASE;

      ranked.push({ modelId: ms.modelId, weighted, cost, avgSigma, info });
    }

    // Budget hard filter (if set)
    if (budget.perRequest > 0) {
      const filtered = ranked.filter((r) => r.cost <= budget.perRequest);
      // Fallback: if budget filters everything, ignore budget constraint
      if (filtered.length > 0) ranked = filtered;
    }

    // Unified composite scoring: quality × qw + costEfficiency × cw + latencyEff × lw
    // Cost efficiency is pool-relative: cheapest=1.0, most expensive=0.0
    const lw = this.weights.latencyWeight ?? 0;
    const maxWeighted = Math.max(...ranked.map((r) => r.weighted), 1);
    const minCost = ranked.length > 0 ? Math.min(...ranked.map((r) => r.cost)) : 0;
    const maxCost = ranked.length > 0 ? Math.max(...ranked.map((r) => r.cost)) : 0;
    ranked.sort((a, b) => {
      const aQuality = a.weighted / maxWeighted;
      const bQuality = b.weighted / maxWeighted;
      const aCostEff = poolCostEfficiency(a.cost, minCost, maxCost);
      const bCostEff = poolCostEfficiency(b.cost, minCost, maxCost);
      let aComposite = qw * aQuality + cw * aCostEff;
      let bComposite = qw * bQuality + cw * bCostEff;
      if (lw > 0 && this.latencyMap) {
        const aLatMs = this.latencyMap.get(a.modelId);
        const bLatMs = this.latencyMap.get(b.modelId);
        if (aLatMs != null) aComposite += lw * (1 / (1 + aLatMs / 1000));
        if (bLatMs != null) bComposite += lw * (1 / (1 + bLatMs / 1000));
      }
      return bComposite - aComposite;
    });

    let topN = ranked.slice(0, Math.min(take, ranked.length));

    // Provider diversity: ensure no single provider dominates the team.
    // Allow at most 1 model per provider initially; fill remaining slots round-robin.
    if (topN.length >= 2) {
      const seen = new Map<string, number>(); // provider → count in topN
      const diverse: typeof topN = [];
      const displaced: typeof topN = [];

      for (const r of topN) {
        const provider = r.modelId.split("/")[0] ?? r.modelId;
        const count = seen.get(provider) ?? 0;
        if (count === 0) {
          diverse.push(r);
          seen.set(provider, 1);
        } else {
          displaced.push(r);
        }
      }

      // Fill remaining slots from ranked models not yet selected, preferring new providers
      if (diverse.length < topN.length) {
        const selectedIds = new Set(diverse.map((r) => r.modelId));
        const candidates = ranked.filter((r) => !selectedIds.has(r.modelId));

        for (const c of candidates) {
          if (diverse.length >= topN.length) break;
          const provider = c.modelId.split("/")[0] ?? c.modelId;
          const count = seen.get(provider) ?? 0;
          if (count === 0) {
            diverse.push(c);
            seen.set(provider, 1);
          }
        }

        // If still not enough (few providers available), add back displaced models
        for (const d of displaced) {
          if (diverse.length >= topN.length) break;
          diverse.push(d);
        }
        // Last resort: fill from remaining candidates
        for (const c of candidates) {
          if (diverse.length >= topN.length) break;
          if (!diverse.some((r) => r.modelId === c.modelId)) {
            diverse.push(c);
          }
        }
      }

      topN = diverse;
    }

    // Exploration: in greedy mode, swap in an uncalibrated model.
    // Thompson mode doesn't need this — sigma-based sampling naturally explores.
    if (!useThompson && topN.length >= 2) {
      const topNHasCalibrated = topN.some((r) => r.avgSigma < SIGMA_BASE * 0.9);
      if (topNHasCalibrated) {
        const uncalibrated = ranked
          .filter((r) => r.avgSigma >= SIGMA_BASE * 0.9 && !topN.includes(r));
        if (uncalibrated.length > 0) {
          uncalibrated.sort((a, b) => b.weighted - a.weighted);
          topN[topN.length - 1] = uncalibrated[0]!;
        }
      }
    }

    // Single model: no ensemble, no effectiveCost
    if (take <= 1) {
      const best = topN[0];
      if (!best) {
        return {
          models: [],
          strategy: "composite",
          estimatedCost: 0,
          reason: "no models available",
        };
      }
      return {
        models: [{ modelId: best.modelId, role: "primary", weight: 1.0 }],
        strategy: "composite",
        estimatedCost: best.cost,
        reason: `composite(q=${qw},c=${cw}) "${best.info.name}"`,
      };
    }

    const totalCost = topN.reduce((sum, r) => sum + r.cost, 0);
    const effCost = topN.reduce(
      (sum, r) => sum + estimateEffectiveCost({ model: r.info, inputTokens, outputTokens, rounds: 1 }),
      0,
    );

    return {
      models: topN.map((r) => ({ modelId: r.modelId, weight: 1.0 })),
      strategy: "composite",
      estimatedCost: totalCost,
      effectiveCost: effCost,
      reason: `composite(q=${qw},c=${cw}) top-${topN.length}`,
    };
  }
}

// ============================================================
// DivergeSynthProtocol — Workers (parallel) → Leader (synthesis)
// ============================================================

export class DivergeSynthProtocol implements DeliberationProtocol {
  private readonly consensus?: ConsensusMode;
  private readonly maxRounds: number;
  private readonly protocol?: "diverge-synth" | "debate";
  private readonly retryDeps?: RetryDeps;
  private readonly runDeliberation: (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config?: EngineConfig,
    retryDeps?: RetryDeps,
  ) => Promise<DeliberateOutput>;

  constructor(
    consensus?: ConsensusMode | string,
    maxRounds?: number,
    deliberateFn?: (
      team: TeamComposition,
      input: DeliberateInput,
      deps: EngineDeps,
      config?: EngineConfig,
      retryDeps?: RetryDeps,
    ) => Promise<DeliberateOutput>,
    retryDeps?: RetryDeps,
    protocol?: "diverge-synth" | "debate",
  ) {
    this.consensus = consensus === "leader_decides" ? "leader_decides" : undefined;
    this.maxRounds = maxRounds ?? 1;
    this.protocol = protocol;
    this.runDeliberation = deliberateFn ?? defaultDeliberateFn;
    this.retryDeps = retryDeps;
  }

  async deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
    overrides?: DeliberationOverrides,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("DivergeSynthProtocol: plan.models must not be empty");
    }

    const team = this.buildTeam(plan, scores);

    const input: DeliberateInput = {
      task,
      ...(overrides?.workerInstructions ? { workerInstructions: overrides.workerInstructions } : {}),
      ...(overrides?.leaderInstructions ? { leaderInstructions: overrides.leaderInstructions } : {}),
      ...(overrides?.taskNature ? { taskNature: overrides.taskNature } : {}),
    };

    const engineChat = async (
      model: string,
      messages: ChatMessage[],
    ): Promise<ChatResult> => {
      const result = await chat(model, messages);
      return result;
    };

    const effectiveProtocol = overrides?.protocol ?? this.protocol;
    const effectiveMaxRounds = overrides?.maxRounds ?? this.maxRounds;
    const effectiveConsensus = overrides?.consensus ?? this.consensus;
    const isDebate = effectiveProtocol === "debate";

    const deps: EngineDeps = {
      chat: engineChat,
      buildWorkerMessages,
      buildLeaderMessages,
      ...(isDebate ? { buildDebateWorkerMessages } : {}),
    };

    const config: EngineConfig = {
      maxRounds: isDebate ? Math.max(effectiveMaxRounds, 3) : effectiveMaxRounds,
      consensus: effectiveConsensus,
      leaderContributes: overrides?.leaderContributes,
      protocol: effectiveProtocol,
    };

    const output = await this.runDeliberation(team, input, deps, config, this.retryDeps);

    return {
      result: output.result,
      roundsExecuted: output.roundsExecuted,
      consensusReached: output.consensusReached,
      totalLLMCalls: output.totalLLMCalls,
      modelsUsed: [...output.modelsUsed],
      protocol: isDebate ? "debate" : "diverge-synth",
      totalTokens: output.totalTokens,
      rounds: output.rounds,
    };
  }

  private buildTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    const hasExplicitRoles = plan.models.some((m) => m.role);
    if (hasExplicitRoles) return this.buildExplicitTeam(plan);
    return this.buildAutoTeam(plan, scores);
  }

  private buildExplicitTeam(plan: EnsemblePlan): TeamComposition {
    const workers: TeamMember[] = [];
    let leader: TeamMember | undefined;

    for (const m of plan.models) {
      if (m.role === "leader" && !leader) {
        leader = { model: m.modelId, role: "leader" };
      } else {
        workers.push({ model: m.modelId, role: "worker" });
      }
    }

    if (!leader) leader = { model: plan.models[plan.models.length - 1]!.modelId, role: "leader" };
    // If the auto-assigned leader was already in workers, remove it
    const finalWorkers = workers.filter((w) => w.model !== leader!.model);
    if (finalWorkers.length === 0) {
      finalWorkers.push({ model: plan.models[0]!.modelId, role: "worker" });
    }

    return { workers: finalWorkers, leader };
  }

  private buildAutoTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));
    const modelIds = plan.models.map((m) => m.modelId);

    // Leader selection via Thompson sampling on LEADER_DIMS.
    // Stochastic sampling ensures leader rotation across calls,
    // preventing a single model from always being selected.
    const leaderCapabilities: Record<string, number> = {};
    for (const { dimension, weight } of [
      { dimension: "JUDGMENT", weight: 0.4 },
      { dimension: "ANALYSIS", weight: 0.3 },
      { dimension: "REASONING", weight: 0.2 },
      { dimension: "SELF_CONSISTENCY", weight: 0.1 },
    ]) {
      leaderCapabilities[dimension] = weight;
    }

    let leaderId = modelIds[modelIds.length - 1]!;
    let bestScore = -Infinity;
    for (const id of modelIds) {
      const ms = scoreMap.get(id);
      if (!ms) continue;
      const sampled = computeWeightedThompson(ms, leaderCapabilities);
      if (sampled > bestScore) {
        bestScore = sampled;
        leaderId = id;
      }
    }

    // Workers: everyone else
    const workerIds = modelIds.filter((id) => id !== leaderId);
    if (workerIds.length === 0) workerIds.push(leaderId);

    const workers: TeamMember[] = workerIds.map((id) => ({
      model: id,
      role: "worker" as const,
    }));

    return {
      workers,
      leader: { model: leaderId, role: "leader" },
    };
  }
}

// Backward compatibility alias
export { DivergeSynthProtocol as RoleBasedProtocol };
