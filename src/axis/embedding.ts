/**
 * EmbeddingSimilarity — Tier 1 embedding-based model recommendation.
 *
 * Uses text embeddings to find historically successful models for similar prompts.
 * Includes an LRU cache for embedding vectors.
 */

export type EmbedFn = (text: string) => Promise<number[]>;

export interface HistoryEntry {
  embedding: number[];
  modelId: string;
  quality: number;
}

export interface EmbeddingSimilarityOptions {
  embedFn: EmbedFn;
  maxCacheSize?: number;
}

const DEFAULT_MAX_CACHE_SIZE = 1000;

export class EmbeddingSimilarity {
  private readonly embedFn: EmbedFn;
  private readonly maxCacheSize: number;
  private readonly cache = new Map<string, number[]>();

  constructor(opts: EmbeddingSimilarityOptions) {
    this.embedFn = opts.embedFn;
    this.maxCacheSize = opts.maxCacheSize ?? DEFAULT_MAX_CACHE_SIZE;
  }

  /**
   * Find models from history most similar to the given prompt.
   * Returns model IDs sorted by descending cosine similarity.
   *
   * @param prompt - The text to embed and compare
   * @param history - Historical entries with pre-computed embeddings
   * @param topK - Maximum number of results (default: all)
   * @returns model IDs of the most similar historical entries
   */
  async findSimilar(
    prompt: string,
    history: HistoryEntry[],
    topK?: number,
  ): Promise<string[]> {
    if (history.length === 0) return [];

    let promptVec: number[];
    try {
      promptVec = await this.embed(prompt);
    } catch {
      return [];
    }

    // Compute similarity for each history entry
    const scored = history.map((entry) => ({
      modelId: entry.modelId,
      similarity: this.cosineSimilarity(promptVec, entry.embedding),
    }));

    // Sort by similarity descending
    scored.sort((a, b) => b.similarity - a.similarity);

    const limit = topK ?? scored.length;
    return scored.slice(0, limit).map((s) => s.modelId);
  }

  /**
   * Compute cosine similarity between two vectors.
   */
  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    if (denom === 0) return 0;

    return dot / denom;
  }

  /**
   * Embed text via API or cache.
   * LRU eviction: when cache exceeds maxCacheSize, removes oldest entry.
   */
  private async embed(text: string): Promise<number[]> {
    // Cache hit
    if (this.cache.has(text)) {
      return this.cache.get(text)!;
    }

    // Cache miss → call embedFn
    const vector = await this.embedFn(text);

    // Evict oldest if full
    if (this.cache.size >= this.maxCacheSize) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(text, vector);
    return vector;
  }
}
