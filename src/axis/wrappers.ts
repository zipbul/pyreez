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
import { ModelRegistry } from "../model/registry";
import type { CapabilityDimension, ModelInfo } from "../model/types";

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
