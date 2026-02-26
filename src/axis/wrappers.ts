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
import { selectModel } from "../router/selector";
import type { BudgetConfig as RouterBudgetConfig } from "../router/types";
import { ModelRegistry } from "../model/registry";
import type { CapabilityDimension, ModelInfo } from "../model/types";
import { SIGMA_BASE } from "../model/types";
import {
  extractRatingsMap,
  persistRatings,
  type PersistIO,
} from "../model/calibration";
import {
  updateRating as btUpdateRating,
  getRating as btGetRating,
  setRating as btSetRating,
} from "../evaluation/bt-updater";
import type { PairwiseOutcome } from "../evaluation/types";
import type { ChatMessage } from "../llm/types";
import { deliberate as defaultDeliberateFn } from "../deliberation/engine";
import type { EngineDeps, EngineConfig } from "../deliberation/engine";
import type { DeliberateOutput } from "../deliberation/types";
import {
  buildProducerMessages,
  buildReviewerMessages,
  buildLeaderMessages,
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
  estimateAmortizedCost,
} from "../cost/effective-cost";

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
} from "./interfaces";

// -- Shared registry (lazy singleton) --

let _registry: ModelRegistry | null = null;
function getRegistry(): ModelRegistry {
  if (!_registry) _registry = new ModelRegistry();
  return _registry;
}

/** Compute overall composite score from all dimension mu values. */
function computeOverall(dimensions: Record<string, { mu: number; sigma: number }>): number {
  const entries = Object.values(dimensions);
  if (entries.length === 0) return 0;
  return entries.reduce((sum, d) => sum + d.mu, 0) / entries.length;
}

/** Assign deliberation roles for N models. */
function assignRoles(count: number): string[] {
  if (count <= 1) return ["primary"];
  if (count === 2) return ["producer", "leader"];
  return Array.from({ length: count }, (_, i) =>
    i === 0 ? "producer" : i === count - 1 ? "leader" : "reviewer",
  );
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
    const ratings = extractRatingsMap(registry.getAll());

    for (const r of results) {
      if (!VALID_OUTCOMES.includes(r.outcome)) continue;

      const dim = r.dimension as CapabilityDimension;
      const rA = btGetRating(ratings, r.modelAId, dim);
      const rB = btGetRating(ratings, r.modelBId, dim);
      const { updatedA, updatedB } = btUpdateRating(rA, rB, r.outcome as PairwiseOutcome);
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
      budget: {},
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

  constructor(ensembleSize?: number, registry?: ModelRegistry);
  constructor(private readonly ensembleSize: number = 1, registry?: ModelRegistry) {
    this.registry = registry ?? getRegistry();
  }

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = this.registry;

    const models: ModelInfo[] = [];

    for (const score of scores) {
      const base = registry.getById(score.modelId);
      if (!base) continue;

      const patched: ModelInfo = { ...base };
      const patchedCaps = { ...base.capabilities };
      for (const [dim, { mu, sigma }] of Object.entries(score.dimensions)) {
        const key = dim as CapabilityDimension;
        if (patchedCaps[key]) {
          patchedCaps[key] = { ...patchedCaps[key], mu, sigma };
        }
      }
      patched.capabilities = patchedCaps as ModelInfo["capabilities"];
      models.push(patched);
    }

    const requiredCapabilities: CapabilityRequirement[] = Object.entries(
      req.capabilities,
    ).map(([dimension, weight]) => ({
      dimension: dimension as CapabilityDimension,
      weight,
    }));

    const taskReq: TaskRequirement = {
      taskType: (req.taskType ?? "IMPLEMENT_FEATURE") as TaskType,
      domain: (req.domain ?? "CODING") as TaskDomain,
      requiredCapabilities,
      estimatedInputTokens: req.estimatedInputTokens ?? 500,
      estimatedOutputTokens: req.estimatedOutputTokens ?? 500,
      requiresStructuredOutput: req.constraints.structuredOutput ?? false,
      requiresKorean: req.constraints.requiresKorean ?? false,
      requiresToolCalling: req.constraints.requiresToolCalling ?? false,
      criticality: req.criticality as TaskRequirement["criticality"],
    };

    const routerBudget: RouterBudgetConfig = { perRequest: budget.perRequest };
    const strategy =
      req.criticality === "critical" || req.criticality === "high"
        ? "quality-first"
        : "cost-first";

    if (this.ensembleSize <= 1) {
      const result = selectModel(models, taskReq, routerBudget);
      const estimatedCost =
        "expectedCost" in result ? result.expectedCost : 0;

      return {
        models: [
          {
            modelId: result.model.id,
            role: "primary",
            weight: 1.0,
          },
        ],
        strategy,
        estimatedCost,
        reason: result.reason,
      };
    }

    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;
    const rounds = this.ensembleSize;
    type Ranked = { modelId: string; weighted: number; cost: number; info: ModelInfo };
    const ranked: Ranked[] = [];

    for (const ms of scores) {
      const info = registry.getById(ms.modelId);
      if (!info) continue;
      const cost = estimateStaticCost(info, inputTokens, outputTokens);
      let weighted = 0;
      const capEntries = Object.entries(req.capabilities);
      if (capEntries.length > 0) {
        for (const [dim, weight] of capEntries) {
          weighted += (ms.dimensions[dim]?.mu ?? ms.overall) * weight;
        }
      } else {
        weighted = ms.overall;
      }
      ranked.push({ modelId: ms.modelId, weighted, cost, info });
    }

    if (strategy === "quality-first") {
      ranked.sort((a, b) => b.weighted - a.weighted);
    } else {
      const FLOOR = 1e-9;
      ranked.sort((a, b) => {
        const aCost = estimateAmortizedCost(a.info, inputTokens, outputTokens, rounds);
        const bCost = estimateAmortizedCost(b.info, inputTokens, outputTokens, rounds);
        return b.weighted / Math.max(bCost, FLOOR) - a.weighted / Math.max(aCost, FLOOR);
      });
    }

    const topN = ranked.slice(0, Math.min(this.ensembleSize, ranked.length));
    const roles = assignRoles(topN.length);
    const totalCost = topN.reduce((sum, r) => sum + r.cost, 0);
    const effCost = topN.reduce(
      (sum, r) => sum + estimateEffectiveCost({ model: r.info, inputTokens, outputTokens, rounds }),
      0,
    );

    return {
      models: topN.map((r, i) => ({ modelId: r.modelId, role: roles[i], weight: 1.0 })),
      strategy,
      estimatedCost: totalCost,
      effectiveCost: effCost,
      reason: `2track-ce ensemble: top-${topN.length} by ${strategy}`,
    };
  }
}

// ============================================================
// RoleBasedProtocol — Producer → Reviewer → Leader deliberation
// ============================================================

export class RoleBasedProtocol implements DeliberationProtocol {
  private readonly consensus: ConsensusMode;
  private readonly maxRounds: number;
  private readonly runDeliberation: (
    team: TeamComposition,
    input: DeliberateInput,
    deps: EngineDeps,
    config: EngineConfig,
  ) => Promise<DeliberateOutput>;

  constructor(
    consensus?: ConsensusMode | string,
    maxRounds?: number,
    deliberateFn?: (
      team: TeamComposition,
      input: DeliberateInput,
      deps: EngineDeps,
      config: EngineConfig,
    ) => Promise<DeliberateOutput>,
  ) {
    const VALID: ConsensusMode[] = ["leader_decides", "all_approve", "majority"];
    this.consensus = VALID.includes(consensus as ConsensusMode)
      ? (consensus as ConsensusMode)
      : "leader_decides";
    this.maxRounds = maxRounds ?? 3;
    this.runDeliberation = deliberateFn ?? defaultDeliberateFn;
  }

  async deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("RoleBasedProtocol: plan.models must not be empty");
    }

    if (plan.models.length === 1) {
      const modelId = plan.models[0]!.modelId;
      const response = await chat(modelId, task);
      return {
        result: response,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [modelId],
        protocol: "role-based",
      };
    }

    const team = this.buildTeam(plan, scores);

    const perspectives = team.reviewers.map(
      (r) => r.perspective ?? `reviewer-${team.reviewers.indexOf(r) + 1}`,
    );

    const input: DeliberateInput = {
      task,
      perspectives: perspectives.length > 0 ? perspectives : ["general"],
    };

    const engineChat = (model: string, messages: ChatMessage[]): Promise<string> =>
      chat(model, messages);

    const deps: EngineDeps = {
      chat: engineChat,
      buildProducerMessages,
      buildReviewerMessages,
      buildLeaderMessages,
    };

    const config: EngineConfig = {
      maxRounds: this.maxRounds,
      consensus: this.consensus,
    };

    const output = await this.runDeliberation(team, input, deps, config);

    return {
      result: output.result,
      roundsExecuted: output.roundsExecuted,
      consensusReached: output.consensusReached,
      totalLLMCalls: output.totalLLMCalls,
      modelsUsed: [...output.modelsUsed],
      protocol: "role-based",
    };
  }

  private buildTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    const hasExplicitRoles = plan.models.some((m) => m.role);
    if (hasExplicitRoles) return this.buildExplicitTeam(plan);
    return this.buildAutoTeam(plan, scores);
  }

  private buildExplicitTeam(plan: EnsemblePlan): TeamComposition {
    let producer: TeamMember | undefined;
    const reviewers: TeamMember[] = [];
    let leader: TeamMember | undefined;

    for (const m of plan.models) {
      const role = m.role ?? "reviewer";
      if (role === "producer" && !producer) {
        producer = { model: m.modelId, role: "producer" };
      } else if (role === "leader" && !leader) {
        leader = { model: m.modelId, role: "leader" };
      } else {
        reviewers.push({
          model: m.modelId,
          role: "reviewer",
          perspective: `reviewer-${reviewers.length + 1}`,
        });
      }
    }

    if (!producer) producer = { model: plan.models[0]!.modelId, role: "producer" };
    if (!leader) leader = { model: plan.models[plan.models.length - 1]!.modelId, role: "leader" };

    return { producer, reviewers, leader };
  }

  private buildAutoTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));
    const modelIds = plan.models.map((m) => m.modelId);

    const getDimScore = (modelId: string, dimension: string): number => {
      const s = scoreMap.get(modelId);
      if (!s) return 0;
      const rating = s.dimensions[dimension];
      if (!rating) return 0;
      const penalty = 1 / (1 + rating.sigma / SIGMA_BASE);
      return rating.mu * penalty;
    };

    let leaderId = modelIds[modelIds.length - 1]!;
    let bestJudgment = -Infinity;
    for (const id of modelIds) {
      const score = getDimScore(id, "JUDGMENT") * 0.4
        + getDimScore(id, "ANALYSIS") * 0.3
        + getDimScore(id, "REASONING") * 0.2
        + getDimScore(id, "SELF_CONSISTENCY") * 0.1;
      if (score > bestJudgment) {
        bestJudgment = score;
        leaderId = id;
      }
    }

    const remaining = modelIds.filter((id) => id !== leaderId);
    let producerId = remaining[0] ?? modelIds[0]!;
    let bestProd = -Infinity;
    for (const id of remaining) {
      const score = getDimScore(id, "CODE_GENERATION") * 0.35
        + getDimScore(id, "CREATIVITY") * 0.25
        + getDimScore(id, "REASONING") * 0.2
        + getDimScore(id, "INSTRUCTION_FOLLOWING") * 0.2;
      if (score > bestProd) {
        bestProd = score;
        producerId = id;
      }
    }

    const reviewerIds = modelIds.filter((id) => id !== leaderId && id !== producerId);
    if (reviewerIds.length === 0) reviewerIds.push(leaderId);

    const reviewers: TeamMember[] = reviewerIds.map((id, i) => ({
      model: id,
      role: "reviewer" as const,
      perspective: `reviewer-${i + 1}`,
    }));

    return {
      producer: { model: producerId, role: "producer" },
      reviewers,
      leader: { model: leaderId, role: "leader" },
    };
  }
}
