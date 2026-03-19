/**
 * SkillCell Store — per-model, per-domain, per-task_type skill profiles.
 *
 * Stores Beta distribution parameters for Thompson Sampling model selection.
 * Persistence: scores/skillcells.json (separate from BT scores in models.json).
 *
 * @module SkillCell Store
 */

import type { SkillCell, FeedbackRecord, BetaParams } from "../axis/types";
import { BINARY_DIMENSIONS, FAILURE_FLAGS } from "../axis/types";

// -- Public Interface --

export interface SkillCellStore {
  /** Get a specific cell. Returns undefined if no data. */
  get(modelId: string, domain: string, taskType: string): SkillCell | undefined;
  /** Get all cells for a domain+taskType. */
  getAll(domain: string, taskType: string): SkillCell[];
  /** Get all cells for a model across all domains. */
  getAllForModel(modelId: string): SkillCell[];
  /** Get all cells for models in a given family. */
  getAllForFamily(family: string, domain: string, taskType: string): SkillCell[];
  /** Update a cell with a new feedback record. */
  update(record: FeedbackRecord): void;
  /** Persist to disk. */
  save(): Promise<void>;
  /** Load from disk. */
  load(): Promise<void>;
}

// -- Persistence I/O --

export interface SkillCellIO {
  readFile(path: string): Promise<string>;
  writeFile(path: string, data: string): Promise<void>;
}

// -- Implementation --

/** Key for the in-memory map. */
function cellKey(modelId: string, domain: string, taskType: string): string {
  return `${modelId}:${domain}:${taskType}`;
}

/** Create a fresh SkillCell with uniform priors. */
function freshCell(modelId: string, domain: string, taskType: string): SkillCell {
  const dimensions: Record<string, BetaParams> = {};
  for (const dim of BINARY_DIMENSIONS) {
    dimensions[dim] = { alpha: 1, beta: 1 };
  }
  const failure_counts: Record<string, number> = {};
  for (const flag of FAILURE_FLAGS) {
    failure_counts[flag] = 0;
  }
  return { model_id: modelId, domain, task_type: taskType, dimensions, failure_counts, total: 0 };
}

export class FileSkillCellStore implements SkillCellStore {
  private cells = new Map<string, SkillCell>();
  private readonly io: SkillCellIO;
  private readonly path: string;
  /** Model family lookup: modelId → family string. */
  private familyLookup: Map<string, string>;

  constructor(opts: { io: SkillCellIO; path: string; familyLookup?: Map<string, string> }) {
    this.io = opts.io;
    this.path = opts.path;
    this.familyLookup = opts.familyLookup ?? new Map();
  }

  get(modelId: string, domain: string, taskType: string): SkillCell | undefined {
    return this.cells.get(cellKey(modelId, domain, taskType));
  }

  getAll(domain: string, taskType: string): SkillCell[] {
    const result: SkillCell[] = [];
    for (const cell of this.cells.values()) {
      if (cell.domain === domain && cell.task_type === taskType) {
        result.push(cell);
      }
    }
    return result;
  }

  getAllForModel(modelId: string): SkillCell[] {
    const result: SkillCell[] = [];
    for (const cell of this.cells.values()) {
      if (cell.model_id === modelId) {
        result.push(cell);
      }
    }
    return result;
  }

  getAllForFamily(family: string, domain: string, taskType: string): SkillCell[] {
    const result: SkillCell[] = [];
    for (const cell of this.cells.values()) {
      if (cell.domain === domain && cell.task_type === taskType) {
        const cellFamily = this.familyLookup.get(cell.model_id);
        if (cellFamily === family) {
          result.push(cell);
        }
      }
    }
    return result;
  }

  update(record: FeedbackRecord): void {
    const key = cellKey(record.model_id, record.domain, record.task_type);
    let cell = this.cells.get(key);
    if (!cell) {
      cell = freshCell(record.model_id, record.domain, record.task_type);
    }

    // Update binary dimensions
    for (const dim of BINARY_DIMENSIONS) {
      const passed = record.dimensions[dim];
      const params = cell.dimensions[dim] ?? { alpha: 1, beta: 1 };
      if (passed) {
        params.alpha += 1;
      } else {
        params.beta += 1;
      }
      cell.dimensions[dim] = params;
    }

    // Update failure counts
    for (const flag of FAILURE_FLAGS) {
      if (record.failures[flag]) {
        cell.failure_counts[flag] = (cell.failure_counts[flag] ?? 0) + 1;
      }
    }

    cell.total += 1;
    this.cells.set(key, cell);
  }

  async save(): Promise<void> {
    const data: Record<string, SkillCell> = {};
    for (const [key, cell] of this.cells) {
      data[key] = cell;
    }
    await this.io.writeFile(this.path, JSON.stringify({ version: 1, cells: data }, null, 2));
  }

  async load(): Promise<void> {
    try {
      const raw = await this.io.readFile(this.path);
      const parsed = JSON.parse(raw);
      if (parsed.version === 1 && parsed.cells) {
        this.cells.clear();
        for (const [key, cell] of Object.entries(parsed.cells)) {
          this.cells.set(key, cell as SkillCell);
        }
      }
    } catch {
      // File doesn't exist yet — start fresh
      this.cells.clear();
    }
  }

  /** Update family lookup (call when registry changes). */
  setFamilyLookup(lookup: Map<string, string>): void {
    this.familyLookup = lookup;
  }
}
