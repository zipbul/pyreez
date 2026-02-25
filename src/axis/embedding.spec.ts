import { describe, it, expect, mock } from "bun:test";
import { EmbeddingSimilarity, type HistoryEntry } from "./embedding";

function makeFakeEmbedFn(vector: number[] = [1, 0, 0]): (text: string) => Promise<number[]> {
  return mock(async (_text: string) => [...vector]);
}

describe("EmbeddingSimilarity", () => {
  // 1. [HP] finds similar models from history
  it("should find similar models from history based on cosine similarity", async () => {
    const embedFn = mock(async (text: string) => {
      if (text === "prompt") return [1, 0, 0];
      return [0.9, 0.1, 0]; // slightly similar
    });

    const sim = new EmbeddingSimilarity({ embedFn });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "model-a", quality: 8 },
      { embedding: [0, 1, 0], modelId: "model-b", quality: 5 },
      { embedding: [0.9, 0.1, 0], modelId: "model-c", quality: 7 },
    ];

    const result = await sim.findSimilar("prompt", history, 2);
    expect(result.length).toBe(2);
    expect(result[0]).toBe("model-a"); // most similar (cos=1.0)
  });

  // 2. [HP] cache hit reuses previous embedding
  it("should reuse cached embedding on second call", async () => {
    let callCount = 0;
    const embedFn = mock(async (_text: string) => {
      callCount++;
      return [1, 0, 0];
    });

    const sim = new EmbeddingSimilarity({ embedFn });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "a", quality: 8 },
    ];

    await sim.findSimilar("same-prompt", history);
    await sim.findSimilar("same-prompt", history);

    expect(callCount).toBe(1); // Only called once, second time from cache
  });

  // 3. [NE] embed fails → returns empty
  it("should return empty array when embed fails", async () => {
    const embedFn = mock(async () => {
      throw new Error("API unavailable");
    });

    const sim = new EmbeddingSimilarity({ embedFn });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "a", quality: 8 },
    ];

    const result = await sim.findSimilar("prompt", history);
    expect(result).toEqual([]);
  });

  // 4. [NE] empty history → returns empty
  it("should return empty array for empty history", async () => {
    const sim = new EmbeddingSimilarity({ embedFn: makeFakeEmbedFn() });
    const result = await sim.findSimilar("prompt", []);
    expect(result).toEqual([]);
  });

  // 5. [ED] single history item returned if similar
  it("should return single item from single-entry history", async () => {
    const sim = new EmbeddingSimilarity({ embedFn: makeFakeEmbedFn([1, 0, 0]) });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "model-a", quality: 8 },
    ];

    const result = await sim.findSimilar("prompt", history, 3);
    expect(result).toEqual(["model-a"]);
  });

  // 6. [ED] cache evicts oldest when full
  it("should evict oldest entry when cache exceeds max size", async () => {
    let callCount = 0;
    const embedFn = mock(async (text: string) => {
      callCount++;
      return [parseFloat(text) || 1, 0, 0];
    });

    const sim = new EmbeddingSimilarity({ embedFn, maxCacheSize: 2 });

    // Fill cache with 2 entries
    await sim.findSimilar("1", [{ embedding: [1, 0, 0], modelId: "a", quality: 5 }]);
    await sim.findSimilar("2", [{ embedding: [1, 0, 0], modelId: "a", quality: 5 }]);
    expect(callCount).toBe(2);

    // Add third → should evict first
    await sim.findSimilar("3", [{ embedding: [1, 0, 0], modelId: "a", quality: 5 }]);
    expect(callCount).toBe(3);

    // Re-request first → should re-embed (was evicted)
    await sim.findSimilar("1", [{ embedding: [1, 0, 0], modelId: "a", quality: 5 }]);
    expect(callCount).toBe(4);
  });

  // 7. [ST] multiple embeds grow cache
  it("should grow cache with different prompts", async () => {
    let callCount = 0;
    const embedFn = mock(async () => {
      callCount++;
      return [1, 0, 0];
    });

    const sim = new EmbeddingSimilarity({ embedFn, maxCacheSize: 100 });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "a", quality: 5 },
    ];

    await sim.findSimilar("prompt-1", history);
    await sim.findSimilar("prompt-2", history);
    await sim.findSimilar("prompt-3", history);
    expect(callCount).toBe(3);

    // All should be cached now
    await sim.findSimilar("prompt-1", history);
    await sim.findSimilar("prompt-2", history);
    await sim.findSimilar("prompt-3", history);
    expect(callCount).toBe(3); // No new calls
  });

  // 8. [ID] same prompt returns same embedding from cache
  it("should return consistent results for same prompt", async () => {
    const sim = new EmbeddingSimilarity({ embedFn: makeFakeEmbedFn([0.5, 0.5, 0]) });
    const history: HistoryEntry[] = [
      { embedding: [1, 0, 0], modelId: "a", quality: 8 },
      { embedding: [0, 1, 0], modelId: "b", quality: 5 },
    ];

    const r1 = await sim.findSimilar("test", history, 2);
    const r2 = await sim.findSimilar("test", history, 2);
    expect(r1).toEqual(r2);
  });
});
