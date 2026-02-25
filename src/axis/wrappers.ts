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
import type { CapabilityDimension, ModelInfo } from "../model/types";
import {
  STEP_PROFILES,
  STEP_DOMAIN,
  STEP_KEYWORD_MAP,
  stepToDimensions,
} from "./step-types";
import type { WorkflowStep } from "./step-types";

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
 * Phase 1: reads mu/sigma directly from registry (no live comparison updates).
 */
export class BtScoringSystem implements ScoringSystem {
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

  /** Phase 5 stub — BT rating persistence not yet implemented. */
  async update(_results: PairwiseResult[]): Promise<void> {
    // TODO: Phase 5 — write updated mu/sigma back to scores/models.json
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

    const result = selectModel(models, taskReq, routerBudget);

    const estimatedCost =
      "expectedCost" in result ? result.expectedCost : 0;
    const strategy =
      req.criticality === "critical" || req.criticality === "high"
        ? "quality-first"
        : "cost-first";

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
}

// ============================================================
// Slot 5 — RoleBasedProtocol (Phase 1 stub)
// ============================================================

/**
 * Phase 1 stub for the role-based deliberation protocol.
 *
 * Full implementation (Phase 6) will wire to the existing deliberation engine
 * (wire.ts / engine.ts). For now, uses the primary model from the EnsemblePlan
 * to produce a single-turn response and wraps it in DeliberationResult shape.
 */
export class RoleBasedProtocol implements DeliberationProtocol {
  async deliberate(
    task: string,
    plan: EnsemblePlan,
    _scores: ModelScore[],
    chat: ChatFn,
  ): Promise<DeliberationResult> {
    // Phase 1 stub: single call to primary model
    const primaryId = plan.models[0]?.modelId ?? "unknown";
    const response = await chat(primaryId, task);

    return {
      result: response,
      roundsExecuted: 0,
      consensusReached: true,
      totalLLMCalls: 1,
      modelsUsed: [primaryId],
      protocol: "role-based",
    };
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
      const cost =
        (inputTokens * info.cost.inputPer1M + outputTokens * info.cost.outputPer1M) / 1_000_000;
      models.push({ model: info, score, estimatedCost: cost });
    }

    // Sort cheapest first
    models.sort((a, b) => a.estimatedCost - b.estimatedCost);

    let selected: string | null = null;
    let totalCost = 0;
    let lastModelId = models[0]?.model.id ?? "";

    for (const { model, score, estimatedCost } of models) {
      if (totalCost + estimatedCost > budget.perRequest && budget.perRequest > 0) break;

      lastModelId = model.id;
      totalCost += estimatedCost;

      // Static confidence = overall / 1000 (mu scale 0-1000 → 0-1)
      const confidence = score.overall / 1000;
      if (passesGate(confidence, CASCADE_CONFIDENCE_THRESHOLD)) {
        selected = model.id;
        break;
      }
    }

    // Fallback: use last attempted
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
  constructor(private readonly table: PreferenceTable = new PreferenceTable()) {}

  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    _budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const modelIds = scores.map((s) => s.modelId);
    // Use criticality as proxy for taskType key (best available without classify roundtrip)
    const taskKey = req.criticality ?? "general";

    const rankings = routeByPreference(this.table, taskKey, modelIds);

    // Find best ranked model that has non-zero confidence (has preference data)
    const withData = rankings.filter((r) => r.confidence > 0);
    let chosenId: string;
    let reason: string;

    if (withData.length > 0) {
      // Pick highest win-rate model
      chosenId = withData[0]!.modelId;
      reason = `Preference routing: "${chosenId}" win-rate=${withData[0]!.score.toFixed(2)}`;
    } else {
      // Fallback: sort by overall BT score
      const sorted = [...scores].sort((a, b) => b.overall - a.overall);
      chosenId = sorted[0]?.modelId ?? modelIds[0] ?? "unknown";
      reason = `Preference fallback (no history): BT overall top model "${chosenId}"`;
    }

    const info = getRegistry().getById(chosenId);
    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;
    const estimatedCost = info
      ? (inputTokens * info.cost.inputPer1M + outputTokens * info.cost.outputPer1M) / 1_000_000
      : 0;

    return {
      models: [{ modelId: chosenId, role: "primary", weight: 1.0 }],
      strategy: "preference",
      estimatedCost,
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
 * update() (Phase 5 stub) uses stepToDimensions() instead of taskToDimensions()
 * to map comparison results to the correct capability dimensions.
 */
export class StepBtScoringSystem implements ScoringSystem {
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

  /** Phase 5 stub — uses stepToDimensions() when fully implemented. */
  async update(_results: PairwiseResult[]): Promise<void> {
    // TODO: Phase 5 — stepToDimensions(result.taskType) for dimension selection
    void stepToDimensions; // reference so tree-shaking keeps the import
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
  async select(
    req: AxisTaskRequirement,
    scores: ModelScore[],
    budget: BudgetConfig,
  ): Promise<EnsemblePlan> {
    const registry = getRegistry();
    const strategy = inferStrategy(req);
    const inputTokens = req.estimatedInputTokens ?? 500;
    const outputTokens = req.estimatedOutputTokens ?? 500;

    type Candidate = {
      modelId: string;
      score: number;
      cost: number;
    };

    const candidates: Candidate[] = [];
    for (const ms of scores) {
      const info = registry.getById(ms.modelId);
      if (!info) continue;
      const cost =
        (inputTokens * info.cost.inputPer1M + outputTokens * info.cost.outputPer1M) / 1_000_000;

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

      candidates.push({ modelId: ms.modelId, score: weighted, cost });
    }

    // Fallback: if all filtered, use everything (ignore budget)
    const pool =
      candidates.length > 0
        ? candidates
        : scores.map((ms) => {
            const info = registry.getById(ms.modelId);
            const cost = info
              ? (inputTokens * info.cost.inputPer1M + outputTokens * info.cost.outputPer1M) / 1_000_000
              : 0;
            return { modelId: ms.modelId, score: ms.overall, cost };
          });

    let sorted: Candidate[];
    switch (strategy) {
      case "economy":
        sorted = [...pool].sort((a, b) => a.cost - b.cost);
        break;
      case "critical":
      case "premium":
        sorted = [...pool].sort((a, b) => b.score - a.score);
        break;
      case "balanced":
      default: {
        // CE = score / cost, with a floor to prevent division by zero
        const COST_FLOOR = 1e-9;
        sorted = [...pool].sort(
          (a, b) => b.score / Math.max(b.cost, COST_FLOOR) - a.score / Math.max(a.cost, COST_FLOOR),
        );
        break;
      }
    }

    const chosen = sorted[0]!;
    return {
      models: [{ modelId: chosen.modelId, role: "primary", weight: 1.0 }],
      strategy,
      estimatedCost: chosen.cost,
      reason: `Four-strategy "${strategy}": selected "${chosen.modelId}" (score=${chosen.score.toFixed(1)}, cost=${chosen.cost.toFixed(5)})`,
    };
  }
}
