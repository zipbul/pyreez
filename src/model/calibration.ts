/**
 * Calibration Loop — real usage results → BT rating auto-update.
 *
 * Extracts pairwise comparison signals from usage data (CallRecords)
 * and updates BT mu/sigma via online updates.
 *
 * Key features:
 * - CallRecord → pairwise signal extraction (same task, different models)
 * - Sigma convergence monitoring
 * - Anomaly detection (sudden mu shifts)
 * - Stale model detection (high sigma after many rounds)
 */

import type { CapabilityDimension, DimensionRating } from "../model/types";
import type { ModelInfo } from "../model/types";
import type { CallRecord } from "../report/types";
import type { PairwiseOutcome, PairwiseResult } from "../evaluation/types";
import {
  updateRating,
  getRating,
  setRating,
  type RatingsMap,
} from "../evaluation/bt-updater";

// -- Constants --

/** Quality score threshold for "strong" signals. */
export const STRONG_QUALITY_DIFF = 3;

/** Minimum quality difference to generate a comparison. */
export const MIN_QUALITY_DIFF = 1;

/** Sigma threshold for marking a model as "converged". */
export const SIGMA_CONVERGED = 100;

/** Sigma threshold for marking a model as "stale" (needs re-evaluation). */
export const SIGMA_STALE = 300;

// -- Task → Dimension Mapping --

/**
 * Map a task type to the primary capability dimensions it exercises.
 */
export function taskToDimensions(taskType: string): CapabilityDimension[] {
  const map: Record<string, CapabilityDimension[]> = {
    // Legacy aliases (backward compat)
    CODE_WRITE: ["CODE_GENERATION", "REASONING"],
    CODE_DEBUG: ["DEBUGGING", "CODE_UNDERSTANDING"],
    MATH: ["MATH_REASONING", "REASONING"],
    CREATIVE: ["CREATIVITY", "INSTRUCTION_FOLLOWING"],
    ARCHITECTURE: ["SYSTEM_THINKING", "REASONING", "ANALYSIS"],
    RESEARCH: ["ANALYSIS", "REASONING", "JUDGMENT"],

    // D1. IDEATION (5)
    BRAINSTORM: ["CREATIVITY", "REASONING"],
    ANALOGY: ["CREATIVITY", "REASONING"],
    CONSTRAINT_DISCOVERY: ["ANALYSIS", "REASONING"],
    OPTION_GENERATION: ["CREATIVITY", "ANALYSIS"],
    FEASIBILITY_QUICK: ["JUDGMENT", "REASONING"],

    // D2. PLANNING (7)
    GOAL_DEFINITION: ["REASONING", "ANALYSIS"],
    SCOPE_DEFINITION: ["SYSTEM_THINKING", "ANALYSIS"],
    PRIORITIZATION: ["JUDGMENT", "ANALYSIS"],
    MILESTONE_PLANNING: ["SYSTEM_THINKING", "REASONING"],
    RISK_ASSESSMENT: ["JUDGMENT", "ANALYSIS", "REASONING"],
    RESOURCE_ESTIMATION: ["REASONING", "ANALYSIS"],
    TRADEOFF_ANALYSIS: ["JUDGMENT", "ANALYSIS", "REASONING"],

    // D3. REQUIREMENTS (6)
    REQUIREMENT_EXTRACTION: ["ANALYSIS", "INSTRUCTION_FOLLOWING"],
    REQUIREMENT_STRUCTURING: ["STRUCTURED_OUTPUT", "ANALYSIS"],
    AMBIGUITY_DETECTION: ["ANALYSIS", "AMBIGUITY_HANDLING"],
    COMPLETENESS_CHECK: ["ANALYSIS", "SELF_CONSISTENCY"],
    CONFLICT_DETECTION: ["ANALYSIS", "REASONING"],
    ACCEPTANCE_CRITERIA: ["STRUCTURED_OUTPUT", "ANALYSIS"],

    // D4. ARCHITECTURE (8)
    SYSTEM_DESIGN: ["SYSTEM_THINKING", "REASONING", "ANALYSIS"],
    MODULE_DESIGN: ["SYSTEM_THINKING", "CODE_GENERATION"],
    INTERFACE_DESIGN: ["SYSTEM_THINKING", "STRUCTURED_OUTPUT"],
    DATA_MODELING: ["SYSTEM_THINKING", "ANALYSIS"],
    PATTERN_SELECTION: ["SYSTEM_THINKING", "JUDGMENT"],
    DEPENDENCY_ANALYSIS: ["SYSTEM_THINKING", "ANALYSIS"],
    MIGRATION_STRATEGY: ["SYSTEM_THINKING", "REASONING"],
    PERFORMANCE_DESIGN: ["SYSTEM_THINKING", "REASONING", "ANALYSIS"],

    // D5. CODING (10)
    CODE_PLAN: ["REASONING", "CODE_GENERATION"],
    SCAFFOLD: ["CODE_GENERATION", "SYSTEM_THINKING"],
    IMPLEMENT_FEATURE: ["CODE_GENERATION", "SYSTEM_THINKING", "REASONING"],
    IMPLEMENT_ALGORITHM: ["CODE_GENERATION", "MATH_REASONING", "REASONING"],
    REFACTOR: ["CODE_UNDERSTANDING", "CODE_GENERATION"],
    OPTIMIZE: ["CODE_UNDERSTANDING", "REASONING", "ANALYSIS"],
    TYPE_DEFINITION: ["CODE_GENERATION", "STRUCTURED_OUTPUT"],
    ERROR_HANDLING: ["CODE_GENERATION", "DEBUGGING"],
    INTEGRATION: ["CODE_GENERATION", "SYSTEM_THINKING"],
    CONFIGURATION: ["CODE_GENERATION", "INSTRUCTION_FOLLOWING"],

    // D6. TESTING (7)
    TEST_STRATEGY: ["SYSTEM_THINKING", "ANALYSIS"],
    TEST_CASE_DESIGN: ["ANALYSIS", "CREATIVITY"],
    UNIT_TEST_WRITE: ["CODE_GENERATION", "ANALYSIS"],
    INTEGRATION_TEST_WRITE: ["CODE_GENERATION", "SYSTEM_THINKING"],
    EDGE_CASE_DISCOVERY: ["CREATIVITY", "ANALYSIS", "REASONING"],
    TEST_DATA_GENERATION: ["CREATIVITY", "CODE_GENERATION"],
    COVERAGE_ANALYSIS: ["ANALYSIS", "CODE_UNDERSTANDING"],

    // D7. REVIEW (7)
    CODE_REVIEW: ["CODE_UNDERSTANDING", "ANALYSIS"],
    DESIGN_REVIEW: ["SYSTEM_THINKING", "JUDGMENT"],
    SECURITY_REVIEW: ["CODE_UNDERSTANDING", "ANALYSIS", "REASONING"],
    PERFORMANCE_REVIEW: ["CODE_UNDERSTANDING", "ANALYSIS"],
    CRITIQUE: ["JUDGMENT", "ANALYSIS"],
    COMPARISON: ["JUDGMENT", "ANALYSIS", "REASONING"],
    STANDARDS_COMPLIANCE: ["ANALYSIS", "INSTRUCTION_FOLLOWING"],

    // D8. DOCUMENTATION (6)
    API_DOC: ["INSTRUCTION_FOLLOWING", "STRUCTURED_OUTPUT"],
    TUTORIAL: ["INSTRUCTION_FOLLOWING", "CREATIVITY"],
    COMMENT_WRITE: ["CODE_UNDERSTANDING", "INSTRUCTION_FOLLOWING"],
    CHANGELOG: ["ANALYSIS", "INSTRUCTION_FOLLOWING"],
    DECISION_RECORD: ["REASONING", "INSTRUCTION_FOLLOWING"],
    DIAGRAM: ["SYSTEM_THINKING", "STRUCTURED_OUTPUT"],

    // D9. DEBUGGING (7)
    ERROR_DIAGNOSIS: ["DEBUGGING", "REASONING"],
    LOG_ANALYSIS: ["DEBUGGING", "ANALYSIS"],
    REPRODUCTION: ["DEBUGGING", "CODE_UNDERSTANDING"],
    ROOT_CAUSE: ["DEBUGGING", "REASONING", "ANALYSIS"],
    FIX_PROPOSAL: ["DEBUGGING", "CODE_GENERATION"],
    FIX_IMPLEMENT: ["DEBUGGING", "CODE_GENERATION", "REASONING"],
    REGRESSION_CHECK: ["DEBUGGING", "ANALYSIS"],

    // D10. OPERATIONS (5)
    DEPLOY_PLAN: ["SYSTEM_THINKING", "REASONING"],
    CI_CD_CONFIG: ["CODE_GENERATION", "SYSTEM_THINKING"],
    ENVIRONMENT_SETUP: ["CODE_GENERATION", "SYSTEM_THINKING"],
    MONITORING_SETUP: ["SYSTEM_THINKING", "ANALYSIS"],
    INCIDENT_RESPONSE: ["DEBUGGING", "REASONING", "ANALYSIS"],

    // D11. RESEARCH (5)
    TECH_RESEARCH: ["ANALYSIS", "REASONING", "JUDGMENT"],
    BENCHMARK: ["ANALYSIS", "REASONING"],
    COMPATIBILITY_CHECK: ["ANALYSIS", "SYSTEM_THINKING"],
    BEST_PRACTICE: ["JUDGMENT", "ANALYSIS"],
    TREND_ANALYSIS: ["ANALYSIS", "REASONING"],

    // D12. COMMUNICATION (5)
    SUMMARIZE: ["ANALYSIS", "INSTRUCTION_FOLLOWING"],
    EXPLAIN: ["REASONING", "INSTRUCTION_FOLLOWING"],
    REPORT: ["ANALYSIS", "STRUCTURED_OUTPUT", "INSTRUCTION_FOLLOWING"],
    TRANSLATE: ["MULTILINGUAL", "INSTRUCTION_FOLLOWING"],
    QUESTION_ANSWER: ["REASONING", "INSTRUCTION_FOLLOWING"],

    // Legacy aliases (backward compat)
    TOOL_USE: ["TOOL_USE", "INSTRUCTION_FOLLOWING"],
  };
  return map[taskType] ?? ["REASONING"];
}

// -- CallRecord → Pairwise Signal --

/**
 * Extract pairwise comparison signals from call records.
 * Groups by taskType, compares quality scores between different models.
 */
export function extractPairwise(records: CallRecord[]): PairwiseResult[] {
  // Group by taskType
  const byTask = new Map<string, CallRecord[]>();
  for (const r of records) {
    if (!byTask.has(r.taskType)) byTask.set(r.taskType, []);
    byTask.get(r.taskType)!.push(r);
  }

  const results: PairwiseResult[] = [];

  for (const [taskType, taskRecords] of byTask) {
    // Compare each pair of different models within same task type
    for (let i = 0; i < taskRecords.length; i++) {
      for (let j = i + 1; j < taskRecords.length; j++) {
        const a = taskRecords[i]!;
        const b = taskRecords[j]!;
        if (a.model === b.model) continue;

        const diff = a.quality - b.quality;
        if (Math.abs(diff) < MIN_QUALITY_DIFF) continue;

        let outcome: PairwiseOutcome;
        if (diff >= STRONG_QUALITY_DIFF) outcome = "A>>B";
        else if (diff > 0) outcome = "A>B";
        else if (diff <= -STRONG_QUALITY_DIFF) outcome = "B>>A";
        else outcome = "B>A";

        results.push({
          promptId: `usage-${taskType}-${i}-${j}`,
          modelA: a!.model,
          modelB: b!.model,
          judge: "usage-quality",
          outcome,
          swapped: false,
          reasoning: `Quality diff: ${diff.toFixed(1)} (${a!.quality} vs ${b!.quality})`,
          confidence: Math.min(1.0, Math.abs(diff) / 10),
        });
      }
    }
  }

  return results;
}

// -- Calibration --

export interface CalibrationResult {
  /** Number of pairwise comparisons processed. */
  comparisonsProcessed: number;
  /** Models that had anomalous updates. */
  anomalies: Array<{ modelId: string; dimension: CapabilityDimension; muDelta: number }>;
  /** Models with converged ratings (low sigma). */
  converged: Array<{ modelId: string; dimension: CapabilityDimension; sigma: number }>;
  /** Models with stale ratings (high sigma, needs re-evaluation). */
  stale: Array<{ modelId: string; dimension: CapabilityDimension; sigma: number }>;
}

/**
 * Run a calibration cycle:
 * 1. Extract pairwise signals from call records
 * 2. Update BT ratings
 * 3. Monitor sigma convergence
 * 4. Detect anomalies
 */
export function calibrate(
  ratings: RatingsMap,
  records: CallRecord[],
): CalibrationResult {
  const pairwise = extractPairwise(records);

  const anomalies: CalibrationResult["anomalies"] = [];
  const converged: CalibrationResult["converged"] = [];
  const stale: CalibrationResult["stale"] = [];

  // Process each pairwise result
  for (const result of pairwise) {
    const dimensions = taskToDimensions(
      result.promptId.split("-")[1] ?? "REASONING",
    );

    for (const dim of dimensions) {
      const ratingA = getRating(ratings, result.modelA, dim);
      const ratingB = getRating(ratings, result.modelB, dim);

      const { updatedA, updatedB, anomaly } = updateRating(
        ratingA,
        ratingB,
        result.outcome,
      );

      if (anomaly) {
        anomalies.push({
          modelId: result.modelA,
          dimension: dim,
          muDelta: updatedA.mu - ratingA.mu,
        });
      }

      setRating(ratings, result.modelA, dim, updatedA);
      setRating(ratings, result.modelB, dim, updatedB);
    }
  }

  // Scan all ratings for convergence/staleness
  for (const [modelId, dims] of ratings) {
    for (const [dim, rating] of dims) {
      if (rating.sigma <= SIGMA_CONVERGED && rating.comparisons > 0) {
        converged.push({ modelId, dimension: dim, sigma: rating.sigma });
      } else if (rating.sigma >= SIGMA_STALE) {
        stale.push({ modelId, dimension: dim, sigma: rating.sigma });
      }
    }
  }

  return {
    comparisonsProcessed: pairwise.length,
    anomalies,
    converged,
    stale,
  };
}

// -- Ratings Map Extraction --

/**
 * Build a RatingsMap from ModelInfo array.
 * Copies mu/sigma/comparisons from each model's capabilities.
 */
export function extractRatingsMap(models: ModelInfo[]): RatingsMap {
  const map: RatingsMap = new Map();
  for (const model of models) {
    const dimMap = new Map<CapabilityDimension, DimensionRating>();
    for (const [dim, rating] of Object.entries(model.capabilities ?? {})) {
      dimMap.set(dim as CapabilityDimension, rating as DimensionRating);
    }
    map.set(model.id, dimMap);
  }
  return map;
}

// -- Persist Ratings --

/**
 * Minimal I/O interface for persistRatings.
 * Kept separate from FileIO to avoid coupling calibration to report module.
 */
export interface PersistIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
  /** Atomic rename (tmp → target). Optional; when absent, writeFile is used directly. */
  rename?(from: string, to: string): Promise<void>;
}

/**
 * Write updated BT ratings back into models.json.
 * Reads the current JSON, patches matching dim entries, then writes.
 */
export async function persistRatings(
  filePath: string,
  ratings: RatingsMap,
  io: PersistIO,
): Promise<void> {
  const raw = await io.readFile(filePath);
  const json = JSON.parse(raw) as {
    version: number;
    models?: Record<
      string,
      { scores?: Record<string, { mu: number; sigma: number; comparisons: number }> }
    >;
  };

  if (typeof json.version !== "number") {
    throw new Error(`persistRatings: invalid models.json — missing or non-numeric "version" field`);
  }

  if (!json.models) json.models = {};

  for (const [modelId, dims] of ratings) {
    let modelEntry = json.models[modelId];
    if (!modelEntry) {
      modelEntry = { scores: {} };
      json.models[modelId] = modelEntry;
    }
    if (!modelEntry.scores) modelEntry.scores = {};

    for (const [dim, rating] of dims) {
      modelEntry.scores[dim] = {
        mu: rating.mu,
        sigma: rating.sigma,
        comparisons: rating.comparisons,
      };
    }
  }

  const data = JSON.stringify(json, null, 2);

  // Atomic write via tmp + rename when available
  if (io.rename) {
    const tmpPath = filePath + ".tmp";
    await io.writeFile(tmpPath, data);
    await io.rename(tmpPath, filePath);
  } else {
    await io.writeFile(filePath, data);
  }
}
