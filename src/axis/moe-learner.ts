/**
 * MoeLearner — L3 Mixture-of-Experts gating weight learning.
 *
 * Online gradient descent: updates expert weights based on quality rewards.
 * Persists weights to gating-weights.json via FileIO.
 */

import { join } from "node:path";
import type { FileIO } from "../report/types";

const DEFAULT_LEARNING_RATE = 0.1;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_BASE_PATH = ".pyreez/learning";

export interface MoeLearnerOptions {
  numExperts: number;
  learningRate?: number;
  batchSize?: number;
  io?: FileIO;
  basePath?: string;
}

export class MoeLearner {
  private readonly numExperts: number;
  private readonly learningRate: number;
  private readonly batchSize: number;
  private readonly io?: FileIO;
  private readonly basePath: string;
  private weights: number[];
  private updateCount = 0;

  constructor(opts: MoeLearnerOptions) {
    this.numExperts = opts.numExperts;
    this.learningRate = opts.learningRate ?? DEFAULT_LEARNING_RATE;
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
    this.io = opts.io;
    this.basePath = opts.basePath ?? DEFAULT_BASE_PATH;

    // Initialize equal weights
    this.weights = Array(this.numExperts).fill(1 / this.numExperts);
  }

  /**
   * Update expert weight based on reward signal.
   * Positive reward → increase weight, negative → decrease.
   * Weights are normalized to sum to 1.0 after update.
   */
  update(expertIdx: number, reward: number): void {
    if (expertIdx < 0 || expertIdx >= this.numExperts) return;

    this.weights[expertIdx] += this.learningRate * reward;

    // Clamp to non-negative
    for (let i = 0; i < this.numExperts; i++) {
      this.weights[i] = Math.max(0, this.weights[i]!);
    }

    // Normalize to sum to 1.0
    const sum = this.weights.reduce((a, b) => a + b, 0);
    if (sum > 0) {
      for (let i = 0; i < this.numExperts; i++) {
        this.weights[i] = this.weights[i]! / sum;
      }
    } else {
      // All zero → reset to equal
      this.weights = Array(this.numExperts).fill(1 / this.numExperts);
    }

    this.updateCount++;
  }

  /** Get current normalized weights. */
  getWeights(): number[] {
    return [...this.weights];
  }

  /** Whether enough updates have accumulated for a flush. */
  shouldFlush(): boolean {
    return this.updateCount > 0 && this.updateCount % this.batchSize === 0;
  }

  /** Persist weights to JSON file. Swallows IO errors. */
  async flush(): Promise<void> {
    if (!this.io) return;
    try {
      await this.io.mkdir(this.basePath);
      await this.io.writeFile(
        join(this.basePath, "gating-weights.json"),
        JSON.stringify({ weights: this.weights }, null, 2),
      );
    } catch {
      // Swallow — persistence is best-effort
    }
  }

  /** Load weights from JSON file. On failure, keeps default equal weights. */
  async load(): Promise<void> {
    if (!this.io) return;
    try {
      const raw = await this.io.readFile(
        join(this.basePath, "gating-weights.json"),
      );
      const data = JSON.parse(raw);
      if (Array.isArray(data.weights) && data.weights.length === this.numExperts) {
        this.weights = data.weights;
      }
    } catch {
      // File not found or invalid → keep defaults
    }
  }
}
