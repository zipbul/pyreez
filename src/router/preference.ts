/**
 * Preference Router — RouteLLM Matrix Factorization approach.
 *
 * Routes queries to models based on learned preference data from
 * deliberation/evaluation pairwise outcomes.
 *
 * Approach: lightweight Matrix Factorization (MF) style scoring.
 * Each model has a latent vector. Each query type has a latent vector.
 * Preference score = dot product of query vector and model vector.
 *
 * In practice (without actual training), we use:
 * 1. Preference history table (taskType × model → win rate)
 * 2. Query classification → most similar historical query type
 * 3. Score = historical win rate for that model on that query type
 */

// -- Types --

/**
 * Minimal pairwise input for preference recording.
 * Evaluation's PairwiseResult structurally satisfies this (structural subtyping).
 */
export interface PreferenceInput {
  modelA: string;
  modelB: string;
  outcome: string;
}

/**
 * A preference entry: win/loss/tie record for a model on a task type.
 */
export interface PreferenceEntry {
  modelId: string;
  taskType: string;
  wins: number;
  losses: number;
  ties: number;
  lastUpdated?: number;
}

/**
 * A routing recommendation from the preference router.
 */
export interface PreferenceRouting {
  modelId: string;
  score: number;
  confidence: number;
}

// -- Preference Table --

/**
 * In-memory preference table: taskType → modelId → PreferenceEntry.
 */
export class PreferenceTable {
  private readonly entries = new Map<string, Map<string, PreferenceEntry>>();

  /** Record a single pairwise result into the preference table. */
  record(result: PreferenceInput, taskType: string): void {
    this.ensureEntry(taskType, result.modelA);
    this.ensureEntry(taskType, result.modelB);

    const entryA = this.getEntry(taskType, result.modelA)!;
    const entryB = this.getEntry(taskType, result.modelB)!;

    const now = Date.now();
    entryA.lastUpdated = now;
    entryB.lastUpdated = now;

    switch (result.outcome) {
      case "A>>B":
      case "A>B":
        entryA.wins++;
        entryB.losses++;
        break;
      case "B>>A":
      case "B>A":
        entryA.losses++;
        entryB.wins++;
        break;
      case "A=B":
        entryA.ties++;
        entryB.ties++;
        break;
    }
  }

  /** Record multiple results. */
  recordAll(results: PreferenceInput[], taskType: string): void {
    for (const r of results) this.record(r, taskType);
  }

  /** Get the preference entry for a model on a task type. */
  getEntry(taskType: string, modelId: string): PreferenceEntry | undefined {
    return this.entries.get(taskType)?.get(modelId);
  }

  /** Get all entries for a task type. */
  getEntriesForTask(taskType: string): PreferenceEntry[] {
    const taskEntries = this.entries.get(taskType);
    if (!taskEntries) return [];
    return Array.from(taskEntries.values());
  }

  /** Get all known task types. */
  taskTypes(): string[] {
    return Array.from(this.entries.keys());
  }

  /** Get all known model IDs across all task types. */
  modelIds(): string[] {
    const ids = new Set<string>();
    for (const taskEntries of this.entries.values()) {
      for (const id of taskEntries.keys()) ids.add(id);
    }
    return Array.from(ids);
  }

  /** Total number of comparisons recorded. */
  get totalComparisons(): number {
    let total = 0;
    for (const taskEntries of this.entries.values()) {
      for (const entry of taskEntries.values()) {
        total += entry.wins + entry.losses + entry.ties;
      }
    }
    // Each comparison records 2 entries (both models)
    return total / 2;
  }

  /** Directly load an entry (for deserialization — no dummy opponents). */
  loadEntry(taskType: string, modelId: string, wins: number, losses: number, ties: number, lastUpdated?: number): void {
    this.ensureEntry(taskType, modelId);
    const entry = this.getEntry(taskType, modelId)!;
    entry.wins = wins;
    entry.losses = losses;
    entry.ties = ties;
    if (lastUpdated != null) entry.lastUpdated = lastUpdated;
  }

  private ensureEntry(taskType: string, modelId: string): void {
    if (!this.entries.has(taskType)) this.entries.set(taskType, new Map());
    const taskEntries = this.entries.get(taskType)!;
    if (!taskEntries.has(modelId)) {
      taskEntries.set(modelId, {
        modelId,
        taskType,
        wins: 0,
        losses: 0,
        ties: 0,
      });
    }
  }
}

// -- Win Rate Calculation --

/**
 * Calculate win rate from a preference entry.
 * Ties count as half a win.
 */
export function winRate(entry: PreferenceEntry): number {
  const total = entry.wins + entry.losses + entry.ties;
  if (total === 0) return 0.5; // no data → neutral
  return (entry.wins + entry.ties * 0.5) / total;
}

/**
 * Calculate confidence from total comparisons.
 * More comparisons → higher confidence.
 */
export function entryConfidence(entry: PreferenceEntry): number {
  const total = entry.wins + entry.losses + entry.ties;
  // Sigmoid-like: approaches 1.0 as total grows
  return total / (total + 10);
}

// -- Time Decay --

const MS_PER_DAY = 86_400_000;

/**
 * Calculate decayed win rate: recent data weighs more than stale data.
 * Uses exponential decay with configurable half-life.
 * Without lastUpdated, returns raw win rate (backward compatible).
 */
export function decayedWinRate(entry: PreferenceEntry, halfLifeDays = 30): number {
  const raw = winRate(entry);
  if (entry.lastUpdated == null || !Number.isFinite(entry.lastUpdated)) return raw;
  const ageDays = Math.max(0, (Date.now() - entry.lastUpdated) / MS_PER_DAY);
  const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);
  return 0.5 + (raw - 0.5) * decayFactor;
}

// -- Router --

/**
 * Route a query to the best model based on preference history.
 * Returns models ranked by preference score (with time decay).
 */
export function routeByPreference(
  table: PreferenceTable,
  taskType: string,
  candidateModelIds: string[],
): PreferenceRouting[] {
  const entries = table.getEntriesForTask(taskType);
  const entryMap = new Map(entries.map((e) => [e.modelId, e]));

  return candidateModelIds
    .map((modelId) => {
      const entry = entryMap.get(modelId);
      if (!entry) return { modelId, score: 0.5, confidence: 0 };
      return {
        modelId,
        score: decayedWinRate(entry),
        confidence: entryConfidence(entry),
      };
    })
    .sort((a, b) => b.score - a.score || b.confidence - a.confidence);
}
