/**
 * LocalLearningLayer — Tier 0 learning layer for the axis pipeline.
 *
 * Responsibilities:
 * - L2 preference persistence: memory → JSON sync (every N records or 5 min)
 * - Auto-calibrate: after N records, call ScoringSystem.update()
 * - enhance(): boost scores based on preference win rates
 *
 * L1 BT is already owned by ScoringSystem — not duplicated here.
 * L3 (MoE weights) and L4 (MF) require T3 quality scores — deferred to Phase 6.
 */

import { join } from "node:path";
import type { LearningLayer, ScoringSystem } from "./interfaces";
import type {
  TaskClassification,
  EnsemblePlan,
  DeliberationResult,
  ModelScore,
  PairwiseResult,
} from "./types";
import type { FileIO } from "../report/types";
import {
  PreferenceTable,
  winRate,
  type PreferenceInput,
} from "../router/preference";
import type { LlmJudge } from "./judge";
import type { MoeLearner } from "./moe-learner";
import type { MfLearner } from "./mf-learner";

/** Serialized preference data for JSON persistence. */
interface PreferenceData {
  [taskType: string]: {
    [modelId: string]: {
      modelId: string;
      taskType: string;
      wins: number;
      losses: number;
      ties: number;
    };
  };
}

/** Options for LocalLearningLayer constructor. */
export interface LearningLayerOptions {
  scoring: ScoringSystem;
  io: FileIO;
  basePath?: string;
  autoCalibThreshold?: number;
  syncInterval?: number;
  syncTimeoutMs?: number;
  preferenceTable?: PreferenceTable;
  /** Phase 6: LLM-as-Judge for quality evaluation (Tier 3) */
  judge?: LlmJudge;
  /** Phase 6: MoE gating weight learner (L3) */
  moeLearner?: MoeLearner;
  /** Phase 6: Matrix Factorization learner (L4) */
  mfLearner?: MfLearner;
}

const DEFAULT_BASE_PATH = ".pyreez/learning";
const DEFAULT_AUTO_CALIB_THRESHOLD = 50;
const DEFAULT_SYNC_INTERVAL = 10;
const DEFAULT_SYNC_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Preference boost factor: small adjustment based on win rate. */
const PREFERENCE_BOOST_FACTOR = 0.1;

export class LocalLearningLayer implements LearningLayer {
  private readonly scoring: ScoringSystem;
  private readonly io: FileIO;
  private readonly basePath: string;
  private readonly autoCalibThreshold: number;
  private readonly syncInterval: number;
  private readonly syncTimeoutMs: number;
  private readonly preferenceTable: PreferenceTable;
  private readonly judge?: LlmJudge;
  private readonly moeLearner?: MoeLearner;
  private readonly mfLearner?: MfLearner;

  private recordCount = 0;
  private dirty = false;
  private lastSyncTime = Date.now();
  private calibrated = false;
  private readonly pendingPairwise: PairwiseResult[] = [];

  constructor(opts: LearningLayerOptions) {
    this.scoring = opts.scoring;
    this.io = opts.io;
    this.basePath = opts.basePath ?? DEFAULT_BASE_PATH;
    this.autoCalibThreshold = opts.autoCalibThreshold ?? DEFAULT_AUTO_CALIB_THRESHOLD;
    this.syncInterval = opts.syncInterval ?? DEFAULT_SYNC_INTERVAL;
    this.syncTimeoutMs = opts.syncTimeoutMs ?? DEFAULT_SYNC_TIMEOUT_MS;
    this.preferenceTable = opts.preferenceTable ?? new PreferenceTable();
    this.judge = opts.judge;
    this.moeLearner = opts.moeLearner;
    this.mfLearner = opts.mfLearner;
  }

  /** Load preferences from disk. Call once after construction. */
  async init(): Promise<void> {
    await this.loadPreferences();
  }

  // -- LearningLayer interface --

  async record(
    classified: TaskClassification,
    plan: EnsemblePlan,
    result: DeliberationResult,
  ): Promise<void> {
    this.recordCount++;

    // Extract pairwise results from multi-model deliberation
    const pairwise = this.extractPairwiseResults(classified, plan, result);
    for (const pw of pairwise) {
      // Map axis PairwiseResult → PreferenceInput for PreferenceTable
      const input: PreferenceInput = {
        modelA: pw.modelAId,
        modelB: pw.modelBId,
        outcome: pw.outcome,
      };
      this.preferenceTable.record(input, classified.taskType);
      this.pendingPairwise.push(pw);
    }

    if (pairwise.length > 0) {
      this.dirty = true;
    }

    // Sync preferences periodically
    if (
      this.dirty &&
      (this.recordCount % this.syncInterval === 0 ||
        Date.now() - this.lastSyncTime > this.syncTimeoutMs)
    ) {
      try {
        await this.syncPreferences();
      } catch {
        // Swallow IO errors — preference sync is best-effort
      }
    }

    // Auto-calibrate at threshold
    if (this.recordCount >= this.autoCalibThreshold && !this.calibrated) {
      try {
        await this.scoring.update(this.pendingPairwise);
        this.calibrated = true;
      } catch {
        // Swallow — calibration is best-effort
      }
    }

    // Phase 6: T3 LLM-as-Judge → L3/L4 learning
    if (this.judge) {
      try {
        const quality = await this.judge.evaluate(
          classified.taskType,
          result.result,
        );
        // Normalize quality 0-10 → reward -0.5 to +0.5
        const reward = (quality - 5) / 10;

        // L3: Update MoE expert weights
        if (this.moeLearner) {
          // Use first model index as expert hint (simplified)
          this.moeLearner.update(0, reward);
        }

        // L4: Train MF factors
        if (this.mfLearner) {
          // Simplified context/model indexing (0-based by order)
          this.mfLearner.train(0, 0, quality / 10);
        }
      } catch {
        // Swallow — judge/learning failures are best-effort
      }
    }
  }

  async enhance(
    scores: ModelScore[],
    classified: TaskClassification,
  ): Promise<ModelScore[]> {
    if (scores.length === 0) return [];

    return scores.map((s, idx) => {
      let overall = s.overall;

      // L2: Preference-based adjustment
      const entry = this.preferenceTable.getEntry(classified.taskType, s.modelId);
      if (entry) {
        const wr = winRate(entry);
        overall *= 1 + PREFERENCE_BOOST_FACTOR * (wr - 0.5);
      }

      // L4: MF prediction-based adjustment
      if (this.mfLearner) {
        const pred = this.mfLearner.predict(0, idx);
        // Small additive boost based on MF prediction
        overall *= 1 + pred * 0.05;
      }

      return { ...s, overall };
    });
  }

  // -- Private --

  private async syncPreferences(): Promise<void> {
    const data = this.serializePreferences();
    await this.io.mkdir(this.basePath);
    await this.io.writeFile(
      join(this.basePath, "preferences.json"),
      JSON.stringify(data, null, 2),
    );
    this.dirty = false;
    this.lastSyncTime = Date.now();
  }

  private async loadPreferences(): Promise<void> {
    try {
      const raw = await this.io.readFile(
        join(this.basePath, "preferences.json"),
      );
      const data: PreferenceData = JSON.parse(raw);
      this.deserializePreferences(data);
    } catch {
      // File not found or invalid JSON → start fresh
    }
  }

  private serializePreferences(): PreferenceData {
    const data: PreferenceData = {};
    for (const taskType of this.preferenceTable.taskTypes()) {
      data[taskType] = {};
      for (const entry of this.preferenceTable.getEntriesForTask(taskType)) {
        data[taskType][entry.modelId] = {
          modelId: entry.modelId,
          taskType: entry.taskType,
          wins: entry.wins,
          losses: entry.losses,
          ties: entry.ties,
        };
      }
    }
    return data;
  }

  private deserializePreferences(data: PreferenceData): void {
    for (const [taskType, models] of Object.entries(data)) {
      for (const [_modelId, entry] of Object.entries(models)) {
        // Record wins as A>B against a dummy opponent to populate the table
        // This is a simplification — full restore would need internal table access
        for (let i = 0; i < entry.wins; i++) {
          this.preferenceTable.record(
            { modelA: entry.modelId, modelB: "__restore__", outcome: "A>B" },
            taskType,
          );
        }
        for (let i = 0; i < entry.losses; i++) {
          this.preferenceTable.record(
            { modelA: entry.modelId, modelB: "__restore__", outcome: "B>A" },
            taskType,
          );
        }
        for (let i = 0; i < entry.ties; i++) {
          this.preferenceTable.record(
            { modelA: entry.modelId, modelB: "__restore__", outcome: "A=B" },
            taskType,
          );
        }
      }
    }
  }

  /**
   * Extract pairwise results from deliberation.
   * Heuristic: first model in modelsUsed is "winner" (synthesizer output returned).
   * All other models are "losers" in pairwise comparison.
   * T3 LLM-as-Judge (Phase 6) will provide proper quality-based scoring.
   */
  private extractPairwiseResults(
    classified: TaskClassification,
    _plan: EnsemblePlan,
    result: DeliberationResult,
  ): PairwiseResult[] {
    const models = result.modelsUsed;
    if (models.length < 2) return [];

    const winner = models[0]!;
    const pairs: PairwiseResult[] = [];

    for (let i = 1; i < models.length; i++) {
      pairs.push({
        modelAId: winner,
        modelBId: models[i]!,
        outcome: "A>B",
        dimension: "JUDGMENT", // default dimension
        taskType: classified.taskType,
      });
    }

    return pairs;
  }
}
