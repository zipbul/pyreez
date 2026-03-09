/**
 * LocalLearningLayer — Tier 0 learning layer for the axis pipeline.
 *
 * Responsibilities:
 * - L2 preference persistence: memory → JSON sync (every N records or 5 min)
 * - Auto-calibrate: after N records, call ScoringSystem.update()
 * - enhance(): boost scores based on preference win rates
 *
 * L1 BT is already owned by ScoringSystem — not duplicated here.
 * L4 (MF) requires T3 quality scores — deferred to Phase 6.
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
import type { MfLearner } from "./mf-learner";
import { buildTaskTypeIndex, buildModelIndex } from "./mf-index";

/** Serialized preference data for JSON persistence. */
interface PreferenceData {
  [taskType: string]: {
    [modelId: string]: {
      modelId: string;
      taskType: string;
      wins: number;
      losses: number;
      ties: number;
      lastUpdated?: number;
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
  /** Phase 6: Matrix Factorization learner (L4) */
  mfLearner?: MfLearner;
  /** Model IDs for MF index building. Required when mfLearner is set. */
  modelIds?: string[];
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
  private readonly mfLearner?: MfLearner;
  private readonly taskTypeIndex?: Map<string, number>;
  private readonly modelIndex?: Map<string, number>;

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
    this.mfLearner = opts.mfLearner;
    if (this.mfLearner && opts.modelIds) {
      this.taskTypeIndex = buildTaskTypeIndex();
      this.modelIndex = buildModelIndex(opts.modelIds);
    }
  }

  /** Public accessor for the preference table (shared with KNN Selector). */
  get table(): PreferenceTable {
    return this.preferenceTable;
  }

  /** Flush dirty preferences to disk. Call on graceful shutdown. */
  async flush(): Promise<void> {
    if (this.dirty) {
      await this.syncPreferences();
    }
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

      // Online BT: immediate per-pairwise update (Chatbot Arena online variant).
      // Each pairwise result updates BT ratings incrementally (O(1) per pair).
      // Batch calibrate at threshold is kept as dual safety net.
      try {
        await this.scoring.update(pairwise);
      } catch {
        // Swallow — online BT update is best-effort
      }
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

    // Auto-calibrate marker at threshold (online BT already handles updates)
    if (this.recordCount >= this.autoCalibThreshold && !this.calibrated) {
      this.calibrated = true;
    }

    // Phase 6: T3 LLM-as-Judge → L3/L4 learning
    if (this.judge) {
      try {
        const quality = await this.judge.evaluate(
          classified.taskType,
          result.result,
        );
        // L4: Train MF factors with proper indices
        if (this.mfLearner && this.taskTypeIndex && this.modelIndex) {
          const ctxIdx = this.taskTypeIndex.get(classified.taskType);
          if (ctxIdx != null) {
            for (const modelId of result.modelsUsed) {
              const modIdx = this.modelIndex.get(modelId);
              if (modIdx != null) {
                this.mfLearner.train(ctxIdx, modIdx, quality / 10);
              }
            }
          }
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

    return scores.map((s) => {
      let overall = s.overall;

      // L2: Preference-based adjustment
      const entry = this.preferenceTable.getEntry(classified.taskType, s.modelId);
      if (entry) {
        const wr = winRate(entry);
        overall *= 1 + PREFERENCE_BOOST_FACTOR * (wr - 0.5);
      }

      // L4: MF prediction-based adjustment with proper indices
      if (this.mfLearner && this.taskTypeIndex && this.modelIndex) {
        const ctxIdx = this.taskTypeIndex.get(classified.taskType);
        const modIdx = this.modelIndex.get(s.modelId);
        if (ctxIdx != null && modIdx != null) {
          const pred = this.mfLearner.predict(ctxIdx, modIdx);
          // Small additive boost based on MF prediction
          overall *= 1 + pred * 0.05;
        }
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
          ...(entry.lastUpdated != null ? { lastUpdated: entry.lastUpdated } : {}),
        };
      }
    }
    return data;
  }

  private deserializePreferences(data: PreferenceData): void {
    for (const [taskType, models] of Object.entries(data)) {
      for (const [_modelId, entry] of Object.entries(models)) {
        this.preferenceTable.loadEntry(
          taskType,
          entry.modelId,
          entry.wins,
          entry.losses,
          entry.ties,
          entry.lastUpdated,
        );
      }
    }
  }

  /**
   * Extract pairwise results from deliberation.
   * Heuristic: first model in modelsUsed is "winner" (synthesizer output returned).
   * All other models are "losers" in pairwise comparison.
   *
   * Uses "A>B" (weak confidence) instead of "A>>B" (strong confidence).
   * Deliberation results are an indirect signal — explicit feedback (Phase 4) provides
   * the strong signal via "A>>B".
   *
   * Single-model protocol produces no pairwise results (no comparison possible).
   */
  private extractPairwiseResults(
    classified: TaskClassification,
    _plan: EnsemblePlan,
    result: DeliberationResult,
  ): PairwiseResult[] {
    // Single-model runs produce no meaningful pairwise comparison
    if (result.protocol === "single") return [];

    const models = result.modelsUsed;
    if (models.length < 2) return [];

    const winner = models[0]!;
    const pairs: PairwiseResult[] = [];

    for (let i = 1; i < models.length; i++) {
      pairs.push({
        modelAId: winner,
        modelBId: models[i]!,
        outcome: "A>B", // weak confidence — deliberation is indirect signal
        dimension: "JUDGMENT",
        taskType: classified.taskType,
      });
    }

    return pairs;
  }
}
