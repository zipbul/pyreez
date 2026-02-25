/**
 * MfLearner — L4 Matrix Factorization learning.
 *
 * SGD-based matrix factorization: learns latent vectors for contexts (task types)
 * and models, predicting quality scores via dot product.
 *
 * context × model latent affinity: automatically discovers patterns like
 * "long TS refactoring + Claude" from historical quality data.
 */

import { join } from "node:path";
import type { FileIO } from "../report/types";

const DEFAULT_LATENT_DIM = 8;
const DEFAULT_LEARNING_RATE = 0.01;
const DEFAULT_REGULARIZATION = 0.01;
const DEFAULT_BASE_PATH = ".pyreez/learning";

export interface MfLearnerOptions {
  numContexts: number;
  numModels: number;
  latentDim?: number;
  learningRate?: number;
  regularization?: number;
  io?: FileIO;
  basePath?: string;
}

export class MfLearner {
  private readonly numContexts: number;
  private readonly numModels: number;
  private readonly latentDim: number;
  private readonly learningRate: number;
  private readonly regularization: number;
  private readonly io?: FileIO;
  private readonly basePath: string;

  private contextFactors: number[][];
  private modelFactors: number[][];

  constructor(opts: MfLearnerOptions) {
    this.numContexts = opts.numContexts;
    this.numModels = opts.numModels;
    this.latentDim = opts.latentDim ?? DEFAULT_LATENT_DIM;
    this.learningRate = opts.learningRate ?? DEFAULT_LEARNING_RATE;
    this.regularization = opts.regularization ?? DEFAULT_REGULARIZATION;
    this.io = opts.io;
    this.basePath = opts.basePath ?? DEFAULT_BASE_PATH;

    // Random initialization (small values 0-0.1)
    this.contextFactors = this.initFactors(this.numContexts);
    this.modelFactors = this.initFactors(this.numModels);
  }

  /**
   * One SGD training step: adjust factors so predict(ctx, model) → actual.
   */
  train(contextIdx: number, modelIdx: number, actual: number): void {
    if (
      contextIdx < 0 || contextIdx >= this.numContexts ||
      modelIdx < 0 || modelIdx >= this.numModels
    ) {
      return; // Out of range — skip silently
    }

    const ctxVec = this.contextFactors[contextIdx]!;
    const modVec = this.modelFactors[modelIdx]!;

    // Predict: dot product
    let pred = 0;
    for (let k = 0; k < this.latentDim; k++) {
      pred += ctxVec[k]! * modVec[k]!;
    }

    const err = actual - pred;

    // SGD update with L2 regularization
    for (let k = 0; k < this.latentDim; k++) {
      const ctxOld = ctxVec[k]!;
      const modOld = modVec[k]!;

      ctxVec[k] = ctxOld + this.learningRate * (err * modOld - this.regularization * ctxOld);
      modVec[k] = modOld + this.learningRate * (err * ctxOld - this.regularization * modOld);
    }
  }

  /**
   * Predict quality: dot product of context and model latent vectors.
   */
  predict(contextIdx: number, modelIdx: number): number {
    if (
      contextIdx < 0 || contextIdx >= this.numContexts ||
      modelIdx < 0 || modelIdx >= this.numModels
    ) {
      return 0; // Out of range → neutral prediction
    }

    const ctxVec = this.contextFactors[contextIdx]!;
    const modVec = this.modelFactors[modelIdx]!;

    let dot = 0;
    for (let k = 0; k < this.latentDim; k++) {
      dot += ctxVec[k]! * modVec[k]!;
    }
    return dot;
  }

  /** Persist factors to JSON. */
  async flush(): Promise<void> {
    if (!this.io) return;
    try {
      await this.io.mkdir(this.basePath);
      await this.io.writeFile(
        join(this.basePath, "mf-factors.json"),
        JSON.stringify({
          contextFactors: this.contextFactors,
          modelFactors: this.modelFactors,
        }),
      );
    } catch {
      // Swallow — persistence is best-effort
    }
  }

  /** Load factors from JSON. On failure, keeps random init. */
  async load(): Promise<void> {
    if (!this.io) return;
    try {
      const raw = await this.io.readFile(
        join(this.basePath, "mf-factors.json"),
      );
      const data = JSON.parse(raw);
      if (
        Array.isArray(data.contextFactors) &&
        Array.isArray(data.modelFactors) &&
        data.contextFactors.length === this.numContexts &&
        data.modelFactors.length === this.numModels
      ) {
        this.contextFactors = data.contextFactors;
        this.modelFactors = data.modelFactors;
      }
    } catch {
      // File not found or invalid → keep random init
    }
  }

  private initFactors(count: number): number[][] {
    return Array.from({ length: count }, () =>
      Array.from({ length: this.latentDim }, () => Math.random() * 0.1),
    );
  }
}
