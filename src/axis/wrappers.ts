/**
 * Axis wrapper classes — adapts existing implementations to pipeline interfaces.
 *
 * Fixed pipeline (no variants):
 * - BtScoringSystem — Bradley-Terry 21-dimension scoring
 * - DomainOverrideProfiler — domain → capability weight lookup
 * - TwoTrackCeSelector — hard filter + composite score + cost-efficiency
 * - DivergeSynthProtocol — Workers (parallel) → Host (synthesis)
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
import type { EngineDeps, EngineConfig, RetryDeps } from "../deliberation/engine";
import type { ChatResult } from "../axis/types";
import { selectDiverseModels } from "../deliberation/team-composer";
import type { DeliberateOutput } from "../deliberation/types";
import {
  buildWorkerMessages,
  buildDebateWorkerMessages,
} from "../deliberation/prompts";
import type {
  TeamComposition,
  TeamMember,
  DeliberateInput,
  GenerationParams,
} from "../deliberation/types";
import { createCooldownManager } from "../deliberation/cooldown";
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
    if (filteredScores.length === 0) {
      console.warn(
        "TwoTrackCeSelector: all models filtered by constraints (contextWindow=%d, toolCalling=%s), falling back to unfiltered set",
        req.constraints.minContextWindow ?? 0,
        req.constraints.requiresToolCalling ?? false,
      );
      filteredScores = scores;
    }

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

      const sigmaValues = Object.values(ms.dimensions).map((d) => d.sigma);
      const avgSigma = sigmaValues.length > 0
        ? sigmaValues.reduce((a, b) => a + b, 0) / sigmaValues.length
        : SIGMA_BASE;

      ranked.push({ modelId: ms.modelId, weighted, cost, avgSigma, info });
    }

    if (budget.perRequest > 0) {
      const filtered = ranked.filter((r) => r.cost <= budget.perRequest);
      if (filtered.length > 0) ranked = filtered;
    }

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

    // Provider diversity
    if (topN.length >= 2) {
      const seen = new Map<string, number>();
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

        for (const d of displaced) {
          if (diverse.length >= topN.length) break;
          diverse.push(d);
        }
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

    // Single model: no ensemble
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
// DivergeSynthProtocol — Workers (parallel) → Host (synthesis)
// ============================================================

/** Minimal registry interface for DivergeSynthProtocol (accepts both ModelRegistry and filtered subsets). */
export interface DspRegistryLike {
  getAvailable(): ModelInfo[];
  getById(id: string): ModelInfo | undefined;
}

/** Options for DivergeSynthProtocol constructor. */
export interface DivergeSynthProtocolOptions {
  readonly maxRounds?: number;
  readonly deliberateFn?: (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config?: EngineConfig,
    retryDeps?: RetryDeps,
  ) => Promise<DeliberateOutput>;
  readonly retryDeps?: RetryDeps;
  readonly protocol?: "diverge-synth" | "debate";
  readonly registry?: DspRegistryLike;
  /** Shared CooldownManager (process-scoped). When omitted, per-call instance is created. */
  readonly cooldown?: import("../deliberation/cooldown").CooldownManager;
}

export class DivergeSynthProtocol implements DeliberationProtocol {
  private readonly maxRounds: number;
  private readonly protocol?: "diverge-synth" | "debate";
  private readonly retryDeps?: RetryDeps;
  private readonly registry?: DspRegistryLike;
  private readonly sharedCooldown?: import("../deliberation/cooldown").CooldownManager;
  private readonly runDeliberation: (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config?: EngineConfig,
    retryDeps?: RetryDeps,
  ) => Promise<DeliberateOutput>;

  constructor(opts?: DivergeSynthProtocolOptions) {
    this.maxRounds = opts?.maxRounds ?? 1;
    this.protocol = opts?.protocol;
    this.runDeliberation = opts?.deliberateFn ?? defaultDeliberateFn;
    this.retryDeps = opts?.retryDeps;
    this.registry = opts?.registry;
    this.sharedCooldown = opts?.cooldown;
  }

  async deliberate(
    task: string,
    plan: EnsemblePlan,
    _scores: ModelScore[],
    chat: ChatFn,
    overrides?: DeliberationOverrides,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("DivergeSynthProtocol: plan.models must not be empty");
    }

    let team = this.buildTeam(plan);

    // Critique tasks need more workers for perspective diversity.
    const nature = overrides?.taskNature ?? "critique";
    const minTeamSize = nature === "critique" ? 5 : 3;
    if (this.registry && team.workers.length < minTeamSize) {
      const currentIds = new Set(team.workers.map((w) => w.model));
      const available = this.registry.getAvailable().filter((m) => !currentIds.has(m.id));
      const needed = minTeamSize - team.workers.length;
      const extra = selectDiverseModels(available, needed);
      if (extra.length > 0) {
        const extraWorkers: TeamMember[] = extra.map((m) => ({ model: m.id, role: "worker" as const }));
        team = { workers: [...team.workers, ...extraWorkers] };
      }
    }

    const input: DeliberateInput = {
      task,
      ...(overrides?.workerInstructions ? { workerInstructions: overrides.workerInstructions } : {}),
      ...(overrides?.taskNature ? { taskNature: overrides.taskNature } : {}),
    };

    const engineChat = async (
      model: string,
      messages: ChatMessage[],
      params?: GenerationParams,
    ): Promise<ChatResult> => {
      return chat(model, messages, params);
    };

    const effectiveProtocol = overrides?.protocol ?? this.protocol;
    const isDebate = effectiveProtocol === "debate";
    const effectiveMaxRounds = overrides?.maxRounds
      ?? (isDebate ? 3 : this.maxRounds);

    const deps: EngineDeps = {
      chat: engineChat,
      buildWorkerMessages,
      ...(isDebate ? { buildDebateWorkerMessages } : {}),
    };

    const workerGenParams: GenerationParams = {
      temperature: 1.0,
      max_tokens: 2048,
    };

    const config: EngineConfig = {
      maxRounds: effectiveMaxRounds,
      protocol: effectiveProtocol,
      workerGenParams,
    };

    // Build retryDeps: prefer shared cooldown from constructor, create per-call fallback
    const effectiveRetryDeps = this.retryDeps ?? (this.registry ? {
      cooldown: this.sharedCooldown ?? createCooldownManager(),
      getModels: () => this.registry!.getAvailable(),
    } : undefined);

    const output = await this.runDeliberation(team, input, deps, config, effectiveRetryDeps);

    return {
      roundsExecuted: output.roundsExecuted,
      totalLLMCalls: output.totalLLMCalls,
      modelsUsed: [...output.modelsUsed],
      protocol: isDebate ? "debate" : "diverge-synth",
      totalTokens: output.totalTokens,
      rounds: output.rounds,
    };
  }

  private buildTeam(plan: EnsemblePlan): TeamComposition {
    // All models are workers
    const workers: TeamMember[] = plan.models.map((m) => ({
      model: m.modelId,
      role: "worker" as const,
    }));

    return { workers };
  }
}
