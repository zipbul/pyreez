/**
 * Axis wrapper classes — adapts existing implementations to 5-slot interfaces.
 *
 * Each wrapper translates between the axis boundary types (ClassifyOutput,
 * AxisTaskRequirement, EnsemblePlan, …) and the existing internal types
 * (ClassifyResult, TaskRequirement, ModelInfo, …).
 */

import { classifyByRules } from "../classify/classifier";
import type { ClassifyResult, TaskDomain, TaskType } from "../classify/types";
import { profileTask } from "../profile/profiler";
import type { CapabilityRequirement } from "../profile/types";
import type { TaskRequirement } from "../profile/types";
import { selectModel } from "../router/selector";
import type { BudgetConfig as RouterBudgetConfig } from "../router/types";
import { gate } from "../router/gating";
import { buildCascadeChain, passesGate } from "../router/cascade";
import { PreferenceTable, routeByPreference } from "../router/preference";
import { ModelRegistry } from "../model/registry";
import type { CapabilityDimension, DimensionRating, ModelInfo } from "../model/types";
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
  STEP_PROFILES,
  STEP_DOMAIN,
  STEP_KEYWORD_MAP,
  stepToDimensions,
} from "./step-types";
import type { WorkflowStep } from "./step-types";
import {
  estimateStaticCost,
  estimateEffectiveCost,
  estimateAmortizedCost,
} from "../cost/effective-cost";

import type {
  ClassifyOutput,
  AxisTaskRequirement,
  EnsemblePlan,
  ModelScore,
  BudgetConfig,
  RouteHints,
  PairwiseResult,
  DeliberationResult,
  ChatFn,
} from "./types";
import type {
  Classifier,
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
// Slot 2 — KeywordClassifier
// ============================================================

/**
 * Wraps classifyByRules() to produce ClassifyOutput.
 * Falls back to CODING/IMPLEMENT_FEATURE when keyword rules find no match.
 */
export class KeywordClassifier implements Classifier {
  async classify(prompt: string, _hints?: RouteHints): Promise<ClassifyOutput> {
    const raw: ClassifyResult | null = classifyByRules(prompt);

    if (!raw) {
      // Default when no keyword matches
      return {
        domain: "CODING",
        taskType: "IMPLEMENT_FEATURE",
        vocabKind: "taskType",
        complexity: "moderate",
        criticality: "medium",
        method: "rule",
      };
    }

    // Translate method: "hint" (existing) is not in ClassifyOutput, map to "rule"
    const method: ClassifyOutput["method"] =
      raw.method === "llm" ? "llm" : "rule";

    return {
      domain: raw.domain,
      taskType: raw.taskType,
      vocabKind: "taskType",
      complexity: raw.complexity,
      criticality: raw.criticality,
      method,
    };
  }
}

// ============================================================
// Slot 1 — BtScoringSystem
// ============================================================

/**
 * Wraps ModelRegistry to produce ModelScore[] with BT dimensional ratings.
 * getScores() reads mu/sigma from registry. update() applies pairwise BT updates
 * and optionally persists to disk via PersistIO.
 */
export class BtScoringSystem implements ScoringSystem {
  private readonly persistIO?: PersistIO;
  private readonly scoresPath: string;

  constructor(opts?: { persistIO?: PersistIO; scoresPath?: string }) {
    this.persistIO = opts?.persistIO;
    this.scoresPath = opts?.scoresPath ?? "scores/models.json";
  }

  async getScores(modelIds: string[]): Promise<ModelScore[]> {
    const registry = getRegistry();
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
    const registry = getRegistry();
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
// Slot 3 — DomainOverrideProfiler
// ============================================================

/**
 * Wraps profileTask() to produce AxisTaskRequirement from ClassifyOutput.
 *
 * Translation notes:
 * - `language === "ko"` → inject Korean text so profileTask sets requiresKorean=true
 * - requiredCapabilities array → Record<string, number>
 */
export class DomainOverrideProfiler implements Profiler {
  async profile(input: ClassifyOutput): Promise<AxisTaskRequirement> {
    // Build the ClassifyResult that profileTask() expects
    const classifyResult: ClassifyResult = {
      domain: input.domain as TaskDomain,
      taskType: input.taskType as TaskType,
      complexity: input.complexity,
      criticality: input.criticality,
      method: input.method === "llm" ? "llm" : "rule",
    };

    // Pass Korean text when language=ko so KOREAN_REGEX fires in profileTask
    const promptHint = input.language === "ko" ? "한국어 작업" : "";

    const profile: TaskRequirement = profileTask(classifyResult, promptHint);

    // Translate requiredCapabilities[] → Record<dimension, weight>
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
      criticality: profile.criticality,
      estimatedInputTokens: profile.estimatedInputTokens,
      estimatedOutputTokens: profile.estimatedOutputTokens,
    };
  }
}

// ============================================================
// Slot 4 — TwoTrackCeSelector
// ============================================================

/**
 * Wraps selectModel() (2-Track Cost-Efficiency selector) for the axis pipeline.
 *
 * Translation:
 * - AxisTaskRequirement → TaskRequirement (capability Record → CapabilityRequirement[])
 * - scores ModelScore[] → ModelInfo[] (override capabilities with BT mu/sigma)
 * - SelectResult → EnsemblePlan (single element)
 */
export class TwoTrackCeSelector implements Selector {
  constructor(private readonly ensembleSize: number = 1) {}

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = getRegistry();

    // Build ModelInfo[] using registry entries, optionally patched with BT scores
    const scoreMap = new Map<string, ModelScore>(scores.map((s) => [s.modelId, s]));
    const models: ModelInfo[] = [];

    for (const score of scores) {
      const base = registry.getById(score.modelId);
      if (!base) continue;

      // Patch capabilities with live BT scores where available
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

    // Build TaskRequirement from AxisTaskRequirement
    const requiredCapabilities: CapabilityRequirement[] = Object.entries(
      req.capabilities,
    ).map(([dimension, weight]) => ({
      dimension: dimension as CapabilityDimension,
      weight,
    }));

    const taskReq: TaskRequirement = {
      taskType: "IMPLEMENT_FEATURE" as TaskType, // placeholder — Selector only uses capabilities
      domain: "CODING" as TaskDomain,
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

    // Single-model path: use existing selectModel()
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

    // Multi-model path: score all models via scoreMap, sort, take top-N
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

    // quality-first → sort by score DESC, cost-first → sort by cost-efficiency (amortized)
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
// Slot 5 — RoleBasedProtocol (D2: wire to deliberation engine)
// ============================================================

/**
 * Adapts the axis 5-slot pipeline to the real deliberation engine.
 *
 * Role assignment from EnsemblePlan.models + ModelScore[]:
 *   - If plan.models[i].role is set → use explicit roles.
 *   - Otherwise → auto-assign: JUDGMENT-highest → leader,
 *     CODE_GENERATION-highest (excl. leader) → producer, rest → reviewers.
 *
 * ChatFn bridge:
 *   The axis ChatFn accepts (modelId, string | ChatMessage[]).
 *   The deliberation engine expects (model, ChatMessage[]) → string.
 *   This class bridges by passing ChatMessage[] through ChatFn.
 */
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
    // Guard: empty plan
    if (!plan.models.length) {
      throw new Error("RoleBasedProtocol: plan.models must not be empty");
    }

    // Single-model shortcut (no deliberation needed)
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

    // Build team composition
    const team = this.buildTeam(plan, scores);

    // Derive perspectives from reviewers (default perspective per reviewer index)
    const perspectives = team.reviewers.map(
      (r) => r.perspective ?? `reviewer-${team.reviewers.indexOf(r) + 1}`,
    );

    // Build DeliberateInput
    const input: DeliberateInput = {
      task,
      perspectives: perspectives.length > 0 ? perspectives : ["general"],
    };

    // Chat adapter: axis ChatFn → EngineDeps.chat
    const engineChat = (model: string, messages: ChatMessage[]): Promise<string> =>
      chat(model, messages);

    // Assemble engine deps
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

    // Run the real deliberation engine
    const output = await this.runDeliberation(team, input, deps, config);

    // Map DeliberateOutput → DeliberationResult
    return {
      result: output.result,
      roundsExecuted: output.roundsExecuted,
      consensusReached: output.consensusReached,
      totalLLMCalls: output.totalLLMCalls,
      modelsUsed: [...output.modelsUsed],
      protocol: "role-based",
    };
  }

  /**
   * Build TeamComposition from EnsemblePlan + ModelScore[].
   *
   * Strategy:
   * 1. If plan.models have explicit role fields → use them.
   * 2. Otherwise → auto-assign using scores:
   *    - JUDGMENT highest → leader
   *    - CODE_GENERATION highest (excl. leader) → producer
   *    - Remainder → reviewers
   * 3. Fallback (no scores match): first → producer, last → leader, middle → reviewers.
   */
  private buildTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    // Check if any model has an explicit role
    const hasExplicitRoles = plan.models.some((m) => m.role);

    if (hasExplicitRoles) {
      return this.buildExplicitTeam(plan);
    }

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

    // Fallback if missing roles
    if (!producer) {
      producer = { model: plan.models[0]!.modelId, role: "producer" };
    }
    if (!leader) {
      leader = { model: plan.models[plan.models.length - 1]!.modelId, role: "leader" };
    }

    return { producer, reviewers, leader };
  }

  private buildAutoTeam(plan: EnsemblePlan, scores: ModelScore[]): TeamComposition {
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));
    const modelIds = plan.models.map((m) => m.modelId);

    // Score helper: get dimension mu with uncertainty penalty
    const getDimScore = (modelId: string, dimension: string): number => {
      const s = scoreMap.get(modelId);
      if (!s) return 0;
      const rating = s.dimensions[dimension];
      if (!rating) return 0;
      const penalty = 1 / (1 + rating.sigma / SIGMA_BASE);
      return rating.mu * penalty;
    };

    // Find leader: highest JUDGMENT score
    let leaderId = modelIds[modelIds.length - 1]!; // fallback: last
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

    // Find producer: highest CODE_GENERATION + CREATIVITY (excluding leader)
    const remaining = modelIds.filter((id) => id !== leaderId);
    let producerId = remaining[0] ?? modelIds[0]!; // fallback: first remaining
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

    // Reviewers: everyone else
    const reviewerIds = modelIds.filter((id) => id !== leaderId && id !== producerId);

    // Edge case: 2 models → 0 reviewers. The deliberation engine requires ≥ 1 reviewer.
    // Solution: leader doubles as a reviewer with "general" perspective.
    if (reviewerIds.length === 0) {
      reviewerIds.push(leaderId);
    }

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

// ============================================================
// Phase 4 — SingleBestProtocol (D1: no deliberation baseline)
// ============================================================

/**
 * Baseline protocol that simply routes to the first model in the plan.
 * No deliberation — used as a control group for quality/cost comparison.
 */
export class SingleBestProtocol implements DeliberationProtocol {
  async deliberate(
    task: string,
    plan: EnsemblePlan,
    _scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("SingleBestProtocol: plan.models must not be empty");
    }

    const modelId = plan.models[0]!.modelId;
    const result = await chat(modelId, task);

    return {
      result,
      roundsExecuted: 0,
      consensusReached: true,
      totalLLMCalls: 1,
      modelsUsed: [modelId],
      protocol: "single-best",
    };
  }
}

// ============================================================
// Phase 4 — DivergeSynthProtocol (D3: MoA-based)
// ============================================================

/**
 * Diverge-Synthesize protocol (Mixture-of-Agents pattern):
 * Phase 1 — Diverge: all models generate responses in parallel.
 * Phase 2 — Synthesize: best JUDGMENT model merges all responses into one.
 *
 * Single-model shortcut: skip synthesis, return direct response.
 * Partial failure tolerance: only failed diverge responses are excluded.
 */
export class DivergeSynthProtocol implements DeliberationProtocol {
  async deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("DivergeSynthProtocol: plan.models must not be empty");
    }

    // Single-model shortcut
    if (plan.models.length === 1) {
      const modelId = plan.models[0]!.modelId;
      const result = await chat(modelId, task);
      return {
        result,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [modelId],
        protocol: "diverge-synth",
      };
    }

    // Phase 1 — Diverge (parallel)
    const divergeResults = await Promise.allSettled(
      plan.models.map((m) => chat(m.modelId, task)),
    );

    const responses: Array<{ modelId: string; text: string }> = [];
    for (let i = 0; i < divergeResults.length; i++) {
      const r = divergeResults[i]!;
      if (r.status === "fulfilled") {
        responses.push({ modelId: plan.models[i]!.modelId, text: r.value });
      }
    }

    if (responses.length === 0) {
      throw new Error("DivergeSynthProtocol: all diverge calls failed");
    }

    // Phase 2 — Synthesize
    const synthesizerId = this.selectSynthesizer(plan, scores);
    const synthPrompt = this.buildSynthesisPrompt(task, responses);
    const result = await chat(synthesizerId, synthPrompt);

    const modelsUsed = [...new Set([
      ...responses.map((r) => r.modelId),
      synthesizerId,
    ])];

    return {
      result,
      roundsExecuted: 1,
      consensusReached: true,
      totalLLMCalls: responses.length + 1,
      modelsUsed,
      protocol: "diverge-synth",
    };
  }

  /** Select synthesizer: highest JUDGMENT from scores, fallback to last plan model. */
  private selectSynthesizer(plan: EnsemblePlan, scores: ModelScore[]): string {
    const planIds = new Set(plan.models.map((m) => m.modelId));
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));

    let bestId = plan.models[plan.models.length - 1]!.modelId; // fallback: last
    let bestJudgment = -Infinity;

    for (const id of planIds) {
      const s = scoreMap.get(id);
      if (!s) continue;
      const jmu = s.dimensions.JUDGMENT?.mu ?? 0;
      const amu = s.dimensions.ANALYSIS?.mu ?? 0;
      const score = jmu * 0.6 + amu * 0.4;
      if (score > bestJudgment) {
        bestJudgment = score;
        bestId = id;
      }
    }

    return bestId;
  }

  /** Build the synthesis prompt with all diverge responses. */
  private buildSynthesisPrompt(
    task: string,
    responses: Array<{ modelId: string; text: string }>,
  ): string {
    const lines = responses.map(
      (r, i) => `## Response ${i + 1} (${r.modelId})\n${r.text}`,
    );
    return (
      `You are a synthesizer. Compare and integrate the following ${responses.length} responses ` +
      `to produce the best possible answer for the task.\n\n` +
      `### Task\n${task}\n\n` +
      lines.join("\n\n")
    );
  }
}

// ============================================================
// Phase 4 — AdaptiveDelibProtocol (D4: diverge → critique → weighted synth)
// ============================================================

/**
 * Adaptive Deliberation Protocol (ADP):
 * Phase 1 — Diverge: all models generate responses in parallel (same as D3).
 * Phase 2 — Critique: each model critiques every other model's response (N×(N-1) calls).
 * Phase 3 — Synthesize: responses are weighted by critique scores × BT scores,
 *           then synthesized by the model with highest JUDGMENT score.
 *
 * Single-model shortcut: skip critique+synth, return direct response.
 * Partial failure tolerance at both diverge and critique phases.
 */
export class AdaptiveDelibProtocol implements DeliberationProtocol {
  async deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    if (!plan.models.length) {
      throw new Error("AdaptiveDelibProtocol: plan.models must not be empty");
    }

    // Single-model shortcut
    if (plan.models.length === 1) {
      const modelId = plan.models[0]!.modelId;
      const result = await chat(modelId, task);
      return {
        result,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [modelId],
        protocol: "adp",
      };
    }

    // Phase 1 — Diverge (parallel)
    const divergeResults = await Promise.allSettled(
      plan.models.map((m) => chat(m.modelId, task)),
    );

    const responses: Array<{ modelId: string; text: string }> = [];
    for (let i = 0; i < divergeResults.length; i++) {
      const r = divergeResults[i]!;
      if (r.status === "fulfilled") {
        responses.push({ modelId: plan.models[i]!.modelId, text: r.value });
      }
    }

    if (responses.length === 0) {
      throw new Error("AdaptiveDelibProtocol: all diverge calls failed");
    }

    // Phase 2 — Critique (N×(N-1), tolerate failures)
    let critiqueCount = 0;
    const critiques: Array<{ from: string; about: string; score: number }> = [];

    if (responses.length > 1) {
      const critiquePromises: Array<Promise<void>> = [];

      for (const critic of responses) {
        for (const target of responses) {
          if (critic.modelId === target.modelId) continue; // skip self-critique

          const p = chat(
            critic.modelId,
            `Evaluate the following response to the task "${task}":\n\n${target.text}\n\n` +
            `Respond with JSON: {"score": <0-10>, "feedback": "<text>"}`,
          )
            .then((text) => {
              critiqueCount++;
              critiques.push({
                from: critic.modelId,
                about: target.modelId,
                score: this.parseCritiqueScore(text),
              });
            })
            .catch(() => {
              // Tolerate individual critique failures
            });

          critiquePromises.push(p);
        }
      }

      await Promise.allSettled(critiquePromises);
    }

    // Phase 3 — Weighted synthesis
    const weights = this.computeWeights(responses, critiques, scores);
    const synthesizerId = this.selectSynthesizer(plan, scores);

    const synthPrompt = this.buildWeightedSynthPrompt(task, responses, weights);
    const result = await chat(synthesizerId, synthPrompt);

    const modelsUsed = [...new Set([
      ...responses.map((r) => r.modelId),
      synthesizerId,
    ])];

    return {
      result,
      roundsExecuted: 1,
      consensusReached: true,
      totalLLMCalls: responses.length + critiqueCount + 1,
      modelsUsed,
      protocol: "adp",
    };
  }

  /** Parse critique score from LLM response. JSON → regex → default 5. */
  private parseCritiqueScore(text: string): number {
    // Try JSON parse
    try {
      const json = JSON.parse(text);
      if (typeof json.score === "number" && !Number.isNaN(json.score)) {
        return json.score;
      }
    } catch {
      // Fall through to regex
    }

    // Try regex for a number
    const match = text.match(/\d+/);
    if (match) {
      const n = Number(match[0]);
      if (!Number.isNaN(n)) return n;
    }

    // Default
    return 5;
  }

  /** Compute per-response weights from critique scores × BT factor. */
  private computeWeights(
    responses: Array<{ modelId: string; text: string }>,
    critiques: Array<{ from: string; about: string; score: number }>,
    scores: ModelScore[],
  ): number[] {
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));

    const weights = responses.map((resp) => {
      // Average critique score for this response
      const aboutMe = critiques.filter((c) => c.about === resp.modelId);
      const critiqueAvg = aboutMe.length > 0
        ? aboutMe.reduce((sum, c) => sum + c.score, 0) / aboutMe.length
        : 5; // default if no critiques

      // BT factor: JUDGMENT mu / SIGMA_BASE, capped at [0, 3]
      const ms = scoreMap.get(resp.modelId);
      const judgmentMu = ms?.dimensions.JUDGMENT?.mu ?? SIGMA_BASE;
      const btFactor = Math.min(3, Math.max(0, judgmentMu / SIGMA_BASE));

      return critiqueAvg * btFactor;
    });

    // Normalize to sum=1, fallback to equal if all zero
    const total = weights.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      return responses.map(() => 1 / responses.length);
    }
    return weights.map((w) => w / total);
  }

  /** Select synthesizer: highest JUDGMENT from scores, fallback to last plan model. */
  private selectSynthesizer(plan: EnsemblePlan, scores: ModelScore[]): string {
    const planIds = new Set(plan.models.map((m) => m.modelId));
    const scoreMap = new Map(scores.map((s) => [s.modelId, s]));

    let bestId = plan.models[plan.models.length - 1]!.modelId;
    let bestJudgment = -Infinity;

    for (const id of planIds) {
      const s = scoreMap.get(id);
      if (!s) continue;
      const jmu = s.dimensions.JUDGMENT?.mu ?? 0;
      const amu = s.dimensions.ANALYSIS?.mu ?? 0;
      const score = jmu * 0.6 + amu * 0.4;
      if (score > bestJudgment) {
        bestJudgment = score;
        bestId = id;
      }
    }

    return bestId;
  }

  /** Build weighted synthesis prompt. */
  private buildWeightedSynthPrompt(
    task: string,
    responses: Array<{ modelId: string; text: string }>,
    weights: number[],
  ): string {
    const lines = responses.map(
      (r, i) =>
        `## Response ${i + 1} (${r.modelId}, weight: ${weights[i]!.toFixed(2)})\n${r.text}`,
    );
    return (
      `You are a weighted synthesizer. Integrate the following responses based on their weights ` +
      `to produce the best answer.\n\n` +
      `### Task\n${task}\n\n` +
      lines.join("\n\n")
    );
  }
}

// ============================================================
// Phase 2 — MoeGatingProfiler (R-B3)
// ============================================================

/**
 * Wraps MoE gating network (`gate()` from router/gating.ts) to produce
 * AxisTaskRequirement. Uses taskType+domain to compute softmax expert weights
 * automatically — no hardcoded lookup tables.
 */
export class MoeGatingProfiler implements Profiler {
  async profile(input: ClassifyOutput): Promise<AxisTaskRequirement> {
    const result = gate(input.taskType, input.domain);

    // Convert DimensionWeights record → capabilities Record<string, number>
    const capabilities: Record<string, number> = {};
    for (const [dim, weight] of Object.entries(result.weights)) {
      if (weight >= 0.01) {
        capabilities[dim] = weight;
      }
    }

    // Normalize (gate() already normalizes, but defensive re-normalize)
    const total = Object.values(capabilities).reduce((a, b) => a + b, 0);
    if (total > 0 && Math.abs(total - 1.0) > 0.001) {
      for (const k of Object.keys(capabilities)) {
        capabilities[k] = capabilities[k]! / total;
      }
    }

    return {
      capabilities,
      constraints: {
        requiresKorean: input.language === "ko",
      },
      budget: {},
      criticality: input.criticality,
    };
  }
}

// ============================================================
// Phase 2 — CascadeSelector (R-C3)
// ============================================================

/** Confidence threshold for accepting a model in the cascade chain. */
const CASCADE_CONFIDENCE_THRESHOLD = 0.50;

/**
 * Wraps FrugalGPT-style cascade (router/cascade.ts).
 * Sorts models by cost (cheapest first); picks first model whose normalized
 * BT overall score exceeds the confidence threshold.
 *
 * Note: Real confidence checking (LLM-based) is a Phase 6+ feature.
 * Phase 2 uses model's overall BT score as a static proxy.
 */
export class CascadeSelector implements Selector {
  constructor(private readonly ensembleSize: number = 1) {}

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = getRegistry();

    // Build ModelInfo[] from scores (preserving BT-patched capabilities)
    const models: Array<{ model: ModelInfo; score: ModelScore; estimatedCost: number }> = [];
    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;

    for (const score of scores) {
      const info = registry.getById(score.modelId);
      if (!info) continue;
      const cost = estimateStaticCost(info, inputTokens, outputTokens);
      models.push({ model: info, score, estimatedCost: cost });
    }

    // Sort cheapest first
    models.sort((a, b) => a.estimatedCost - b.estimatedCost);

    if (this.ensembleSize <= 1) {
      // Original single-model path
      let selected: string | null = null;
      let totalCost = 0;
      let lastModelId = models[0]?.model.id ?? "";

      for (const { model, score, estimatedCost } of models) {
        if (totalCost + estimatedCost > budget.perRequest && budget.perRequest > 0) break;

        lastModelId = model.id;
        totalCost += estimatedCost;

        const confidence = score.overall / 1000;
        if (passesGate(confidence, CASCADE_CONFIDENCE_THRESHOLD)) {
          selected = model.id;
          break;
        }
      }

      const chosenId = selected ?? lastModelId;

      return {
        models: [{ modelId: chosenId, role: "primary", weight: 1.0 }],
        strategy: "cascade",
        estimatedCost: totalCost,
        reason: selected
          ? `Cascade accepted "${chosenId}" (confidence above threshold)`
          : `Cascade fallback to "${chosenId}" (no model passed gate)`,
      };
    }

    // Multi-model: collect gate-passing models up to ensembleSize
    const rounds = this.ensembleSize;
    const collected: Array<{ modelId: string; cost: number; info: ModelInfo }> = [];
    let totalCost = 0;

    for (const { model, score, estimatedCost } of models) {
      if (totalCost + estimatedCost > budget.perRequest && budget.perRequest > 0) break;
      totalCost += estimatedCost;

      const confidence = score.overall / 1000;
      if (passesGate(confidence, CASCADE_CONFIDENCE_THRESHOLD)) {
        collected.push({ modelId: model.id, cost: estimatedCost, info: model });
        if (collected.length >= this.ensembleSize) break;
      }
    }

    // Fallback: if not enough models passed gate, fill from score-sorted
    if (collected.length < this.ensembleSize) {
      const already = new Set(collected.map((c) => c.modelId));
      const byCost = [...models].filter((m) => !already.has(m.model.id));
      for (const { model, estimatedCost } of byCost) {
        collected.push({ modelId: model.id, cost: estimatedCost, info: model });
        totalCost += estimatedCost;
        if (collected.length >= this.ensembleSize) break;
      }
    }

    const roles = assignRoles(collected.length);
    const effCost = collected.reduce(
      (sum, c) => sum + estimateEffectiveCost({ model: c.info, inputTokens, outputTokens, rounds }),
      0,
    );
    return {
      models: collected.map((c, i) => ({ modelId: c.modelId, role: roles[i], weight: 1.0 })),
      strategy: "cascade",
      estimatedCost: totalCost,
      effectiveCost: effCost,
      reason: `Cascade ensemble: ${collected.length} models (gate threshold=${CASCADE_CONFIDENCE_THRESHOLD})`,
    };
  }
}

// ============================================================
// Phase 2 — PreferenceSelector (R-C4)
// ============================================================

/**
 * Wraps win/loss preference router (router/preference.ts).
 * Uses accumulated W/L/T history per taskType to rank models.
 * Falls back to overall BT score ordering when no preference data exists.
 *
 * Accepts an optional pre-populated PreferenceTable for testing/injection.
 */
export class PreferenceSelector implements Selector {
  constructor(
    private readonly table: PreferenceTable = new PreferenceTable(),
    private readonly ensembleSize: number = 1,
  ) {}

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    _budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = getRegistry();
    const modelIds = scores.map((s) => s.modelId);
    const taskKey = req.criticality ?? "general";
    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;

    const rankings = routeByPreference(this.table, taskKey, modelIds);
    const withData = rankings.filter((r) => r.confidence > 0);

    const n = Math.max(this.ensembleSize, 1);

    // Build ordered list of model IDs
    let ordered: string[];
    let reason: string;

    if (withData.length > 0) {
      ordered = withData.map((r) => r.modelId);
      reason = `Preference routing: top-${Math.min(n, ordered.length)} by win-rate`;
    } else {
      const sorted = [...scores].sort((a, b) => b.overall - a.overall);
      ordered = sorted.map((s) => s.modelId);
      reason = `Preference fallback (no history): BT overall top-${Math.min(n, ordered.length)}`;
    }

    const selected = ordered.slice(0, n);
    const roles = assignRoles(selected.length);
    const rounds = this.ensembleSize;
    let totalCost = 0;
    let effCost = 0;
    for (const id of selected) {
      const info = registry.getById(id);
      if (info) {
        totalCost += estimateStaticCost(info, inputTokens, outputTokens);
        effCost += estimateEffectiveCost({ model: info, inputTokens, outputTokens, rounds });
      }
    }

    return {
      models: selected.map((id, i) => ({ modelId: id, role: roles[i], weight: 1.0 })),
      strategy: "preference",
      estimatedCost: totalCost,
      ...(this.ensembleSize > 1 && { effectiveCost: effCost }),
      reason,
    };
  }
}

// ============================================================
// Phase 3 — StepProfiler (R-B2)
// ============================================================

/**
 * 1-level WorkflowStep → dimension weight lookup.
 * Uses STEP_PROFILES from step-types.ts. No domain-level fallback needed;
 * GENERAL profile serves as the universal default.
 */
export class StepProfiler implements Profiler {
  async profile(input: ClassifyOutput): Promise<AxisTaskRequirement> {
    const step = (input.taskType as WorkflowStep) ?? "GENERAL";
    const profile = STEP_PROFILES[step] ?? STEP_PROFILES.GENERAL;

    // Deep copy so callers can't mutate the static table
    const capabilities: Record<string, number> = { ...profile };

    return {
      capabilities,
      constraints: {
        requiresKorean: input.language === "ko",
      },
      budget: {},
      criticality: input.criticality,
    };
  }
}

// ============================================================
// Phase 3 — StepDeclareClassifier (R-A2)
// ============================================================

/** Rough word-count heuristic for complexity (no external deps). */
function estimateComplexityFromPrompt(
  prompt: string,
): ClassifyOutput["complexity"] {
  const words = prompt.trim().split(/\s+/).length;
  if (words < 20) return "simple";
  if (words < 80) return "moderate";
  return "complex";
}

/** Default criticality per step. */
const STEP_DEFAULT_CRITICALITY: Partial<Record<WorkflowStep, ClassifyOutput["criticality"]>> = {
  DEPLOY:      "high",
  DEBUG:       "medium",
  VALIDATE:    "medium",
  REVIEW:      "medium",
  CONFIGURE:   "medium",
};

/**
 * Accepts an explicit `step` hint from the orchestrator (via RouteHints.step)
 * and directly produces a ClassifyOutput with vocabKind="step".
 *
 * When no step hint is provided, falls back to KeywordClassifier behaviour
 * (vocabKind="taskType"), preserving full backward compatibility.
 */
export class StepDeclareClassifier implements Classifier {
  private readonly keyword = new KeywordClassifier();

  async classify(prompt: string, hints?: RouteHints): Promise<ClassifyOutput> {
    const step = hints?.step?.toUpperCase() as WorkflowStep | undefined;

    if (!step) {
      // No step declared → fall back to keyword classifier
      return this.keyword.classify(prompt, hints);
    }

    const domain = STEP_DOMAIN[step] ?? STEP_DOMAIN.GENERAL;
    const criticality: ClassifyOutput["criticality"] =
      STEP_DEFAULT_CRITICALITY[step] ?? "low";

    return {
      domain,
      taskType: step,
      vocabKind: "step",
      complexity: estimateComplexityFromPrompt(prompt),
      criticality,
      method: "step-declare",
    };
  }
}

// ============================================================
// Phase 3 — StepBtScoringSystem (S1-b)
// ============================================================

/**
 * WorkflowStep-aware BT scoring system.
 * getScores() is identical to BtScoringSystem (reads from registry).
 * update() applies pairwise BT updates using the explicit dimension from each result.
 */
export class StepBtScoringSystem implements ScoringSystem {
  private readonly persistIO?: PersistIO;
  private readonly scoresPath: string;

  constructor(opts?: { persistIO?: PersistIO; scoresPath?: string }) {
    this.persistIO = opts?.persistIO;
    this.scoresPath = opts?.scoresPath ?? "scores/models.json";
  }

  async getScores(modelIds: string[]): Promise<ModelScore[]> {
    const registry = getRegistry();
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
    const registry = getRegistry();
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
// Phase 3 — FourStrategySelector (R-C2)
// ============================================================

type FourStrategy = "economy" | "balanced" | "premium" | "critical";

/** Infer strategy from criticality when budget.strategy is not set. */
function inferStrategy(req: AxisTaskRequirement): FourStrategy {
  if (req.budget?.strategy) {
    const s = req.budget.strategy as FourStrategy;
    if (["economy", "balanced", "premium", "critical"].includes(s)) return s;
  }
  switch (req.criticality) {
    case "critical": return "critical";
    case "high":     return "premium";
    case "medium":   return "balanced";
    default:         return "economy";
  }
}

/**
 * Four-strategy model selector (R-C2):
 * - economy:  cheapest model (cost ASC)
 * - balanced: best cost-efficiency (score / cost)
 * - premium:  highest capability score (score DESC)
 * - critical: same as premium, budget cap ignored
 */
export class FourStrategySelector implements Selector {
  constructor(private readonly ensembleSize: number = 1) {}

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = getRegistry();
    const strategy = inferStrategy(req);
    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;

    const rounds = this.ensembleSize;

    type Candidate = {
      modelId: string;
      score: number;
      cost: number;
      info: ModelInfo;
    };

    const candidates: Candidate[] = [];
    for (const ms of scores) {
      const info = registry.getById(ms.modelId);
      if (!info) continue;
      const cost = estimateStaticCost(info, inputTokens, outputTokens);

      // Capability-weighted score using req.capabilities weights
      let weighted = 0;
      const capEntries = Object.entries(req.capabilities);
      if (capEntries.length > 0) {
        for (const [dim, weight] of capEntries) {
          const dimRating = ms.dimensions[dim];
          weighted += (dimRating?.mu ?? ms.overall) * weight;
        }
      } else {
        weighted = ms.overall;
      }

      // Apply budget cap only for economy, balanced, premium (not critical)
      if (strategy !== "critical" && budget.perRequest > 0 && cost > budget.perRequest) continue;

      candidates.push({ modelId: ms.modelId, score: weighted, cost, info });
    }

    // Fallback: if all filtered, use everything (ignore budget)
    const pool =
      candidates.length > 0
        ? candidates
        : scores.map((ms) => {
            const info = registry.getById(ms.modelId);
            const cost = info
              ? estimateStaticCost(info, inputTokens, outputTokens)
              : 0;
            return { modelId: ms.modelId, score: ms.overall, cost, info: info! };
          });

    let sorted: Candidate[];
    switch (strategy) {
      case "economy":
        // economy: sort by amortized cost for multi-round awareness
        if (this.ensembleSize > 1) {
          sorted = [...pool].sort((a, b) => {
            const aCost = estimateAmortizedCost(a.info, inputTokens, outputTokens, rounds);
            const bCost = estimateAmortizedCost(b.info, inputTokens, outputTokens, rounds);
            return aCost - bCost;
          });
        } else {
          sorted = [...pool].sort((a, b) => a.cost - b.cost);
        }
        break;
      case "critical":
      case "premium":
        sorted = [...pool].sort((a, b) => b.score - a.score);
        break;
      case "balanced":
      default: {
        const COST_FLOOR = 1e-9;
        if (this.ensembleSize > 1) {
          sorted = [...pool].sort((a, b) => {
            const aCost = estimateAmortizedCost(a.info, inputTokens, outputTokens, rounds);
            const bCost = estimateAmortizedCost(b.info, inputTokens, outputTokens, rounds);
            return b.score / Math.max(bCost, COST_FLOOR) - a.score / Math.max(aCost, COST_FLOOR);
          });
        } else {
          sorted = [...pool].sort(
            (a, b) => b.score / Math.max(b.cost, COST_FLOOR) - a.score / Math.max(a.cost, COST_FLOOR),
          );
        }
        break;
      }
    }

    const n = Math.min(Math.max(this.ensembleSize, 1), sorted.length);
    const topN = sorted.slice(0, n);
    const roles = assignRoles(topN.length);
    const totalCost = topN.reduce((sum, c) => sum + c.cost, 0);
    const effCost = topN.reduce(
      (sum, c) => sum + estimateEffectiveCost({ model: c.info, inputTokens, outputTokens, rounds }),
      0,
    );

    return {
      models: topN.map((c, i) => ({ modelId: c.modelId, role: roles[i], weight: 1.0 })),
      strategy,
      estimatedCost: totalCost,
      ...(this.ensembleSize > 1 && { effectiveCost: effCost }),
      reason: `Four-strategy "${strategy}": top-${topN.length} (best=${topN[0]!.modelId}, score=${topN[0]!.score.toFixed(1)})`,
    };
  }
}

// ============================================================
// Phase 8 — FreeDebateProtocol (D5)
// ============================================================

/**
 * Free-form multi-turn debate protocol.
 *
 * Models take turns responding to the debate prompt with accumulated history.
 * Convergence: last 2 responses share the same first 50 characters.
 * maxTurns = N × 3. On maxTurns or convergence, a synthesis step produces the final result.
 * Single-model shortcut: returns direct response.
 */
export class FreeDebateProtocol implements DeliberationProtocol {
  private readonly defaultChat: ChatFn;

  constructor(chat: ChatFn) {
    this.defaultChat = chat;
  }

  async deliberate(
    task: string,
    plan: EnsemblePlan,
    scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    const models = plan.models.map((m) => m.modelId);
    const effectiveChat = chat ?? this.defaultChat;

    // Single-model shortcut
    if (models.length <= 1) {
      const modelId = models[0] ?? plan.models[0]?.modelId ?? "unknown";
      const result = await effectiveChat(modelId, task);
      return {
        result,
        roundsExecuted: 0,
        consensusReached: true,
        totalLLMCalls: 1,
        modelsUsed: [modelId],
        protocol: "free-debate",
      };
    }

    const maxTurns = models.length * 3;
    const history: Array<{ modelId: string; text: string }> = [];
    let llmCalls = 0;
    let converged = false;

    for (let turn = 0; turn < maxTurns; turn++) {
      const modelId = models[turn % models.length]!;

      // Build prompt with history
      const historyText = history.length > 0
        ? history.map((h) => `[${h.modelId}]: ${h.text}`).join("\n\n")
        : "";

      const prompt = historyText.length > 0
        ? `Debate topic: ${task}\n\nPrevious discussion:\n${historyText}\n\nYour turn:`
        : `Debate topic: ${task}\n\nPlease share your perspective:`;

      try {
        const response = await effectiveChat(modelId, prompt);
        llmCalls++;
        history.push({ modelId, text: response });

        // Check convergence: last 2 responses share first 50 chars
        if (history.length >= 2) {
          const last = history[history.length - 1]!.text.slice(0, 50);
          const prev = history[history.length - 2]!.text.slice(0, 50);
          if (last === prev) {
            converged = true;
            break;
          }
        }
      } catch {
        // Tolerate individual model failures — skip this turn
      }
    }

    // Synthesis step
    const synthesizer = models[0]!;
    const summaryPrompt =
      `Synthesize the following debate into a final answer.\n\n` +
      `Topic: ${task}\n\n` +
      history.map((h) => `[${h.modelId}]: ${h.text}`).join("\n\n");

    const result = await effectiveChat(synthesizer, summaryPrompt);
    llmCalls++;

    return {
      result,
      roundsExecuted: history.length,
      consensusReached: converged,
      totalLLMCalls: llmCalls,
      modelsUsed: [...new Set(history.map((h) => h.modelId))],
      protocol: "free-debate",
    };
  }
}

// ============================================================
// Phase 8 — LlmJudgeScoringSystem (S3)
// ============================================================

/**
 * Wraps a base ScoringSystem and (optionally) applies LLM judge evaluation.
 *
 * getScores() delegates to base. Judge evaluation is a passive quality layer —
 * scores returned are from the base system (judge failures are silently ignored).
 * update() delegates directly to base.
 */
export class LlmJudgeScoringSystem implements ScoringSystem {
  private readonly judge: { evaluate(task: string, response: string): Promise<number> };
  private readonly base: ScoringSystem;

  constructor(
    judge: { evaluate(task: string, response: string): Promise<number> },
    base: ScoringSystem,
  ) {
    this.judge = judge;
    this.base = base;
  }

  async getScores(modelIds: string[]): Promise<ModelScore[]> {
    return this.base.getScores(modelIds);
  }

  async update(results: PairwiseResult[]): Promise<void> {
    return this.base.update(results);
  }
}

// ============================================================
// Phase 8 — MabSelector (R-C5)
// ============================================================

/**
 * Thompson Sampling multi-armed bandit selector.
 *
 * Each model arm maintains (wins, losses) counts.
 * select() samples from Beta(wins+1, losses+1) per model,
 * sorts by sample, and returns top-K within maxModels.
 *
 * Default prior is Beta(1,1) = uniform.
 */
export class MabSelector implements Selector {
  private readonly maxModels: number;
  private readonly arms: Map<string, { wins: number; losses: number }> = new Map();

  constructor(ensembleSize: number = 3) {
    this.maxModels = ensembleSize;
  }

  /** Record an outcome for a model arm. */
  recordOutcome(modelId: string, win: boolean): void {
    const arm = this.arms.get(modelId) ?? { wins: 0, losses: 0 };
    if (win) arm.wins++;
    else arm.losses++;
    this.arms.set(modelId, arm);
  }

  async select(
    _req: AxisTaskRequirement,
    scores: ModelScore[],
    _budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    if (scores.length === 0) {
      return {
        models: [],
        strategy: "mab",
        estimatedCost: 0,
        reason: "MAB: no candidates",
      };
    }

    // Sample from Beta distribution for each model
    const sampled = scores.map((s) => {
      const arm = this.arms.get(s.modelId) ?? { wins: 0, losses: 0 };
      const sample = this.sampleBeta(arm.wins + 1, arm.losses + 1);
      return { modelId: s.modelId, sample, overall: s.overall };
    });

    // Sort by Thompson sample (descending)
    sampled.sort((a, b) => b.sample - a.sample);

    // Take top-K
    const selected = sampled.slice(0, Math.min(this.maxModels, sampled.length));
    const roles = assignRoles(selected.length);

    return {
      models: selected.map((s, i) => ({ modelId: s.modelId, role: roles[i], weight: 1.0 })),
      strategy: "mab",
      estimatedCost: 0,
      reason: `MAB Thompson Sampling: selected ${selected.map((s) => s.modelId).join(", ")}`,
    };
  }

  /**
   * Sample from Beta(alpha, beta) distribution using the Jöhnk algorithm.
   * For simplicity, uses the inverse transform with gamma variates.
   */
  private sampleBeta(alpha: number, beta: number): number {
    const x = this.sampleGamma(alpha);
    const y = this.sampleGamma(beta);
    if (x + y === 0) return 0.5;
    return x / (x + y);
  }

  /** Sample from Gamma(shape, 1) using Marsaglia-Tsang method. */
  private sampleGamma(shape: number): number {
    if (shape < 1) {
      // Boost: Gamma(shape) = Gamma(shape+1) * U^(1/shape)
      return this.sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
    }

    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);

    while (true) {
      let x: number;
      let v: number;
      do {
        x = this.normalRandom();
        v = 1 + c * x;
      } while (v <= 0);

      v = v * v * v;
      const u = Math.random();

      if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  /** Standard normal random (Box-Muller). */
  private normalRandom(): number {
    const u1 = Math.random();
    const u2 = Math.random();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
}
