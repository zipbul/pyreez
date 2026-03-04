import { describe, it, expect } from "bun:test";
import { buildTaskTypeIndex, buildModelIndex, TASK_TYPE_INDEX, NUM_TASK_TYPES } from "./mf-index";
import { DOMAIN_TASK_TYPES } from "../classify/types";
import type { TaskDomain } from "../classify/types";

describe("mf-index", () => {
  describe("buildTaskTypeIndex", () => {
    it("should map all task types to consecutive indices", () => {
      const index = buildTaskTypeIndex();
      expect(index.size).toBe(NUM_TASK_TYPES);

      // Indices should be 0..N-1 with no gaps
      const values = [...index.values()].sort((a, b) => a - b);
      for (let i = 0; i < NUM_TASK_TYPES; i++) {
        expect(values[i]).toBe(i);
      }
    });

    it("should be deterministic across calls", () => {
      const idx1 = buildTaskTypeIndex();
      const idx2 = buildTaskTypeIndex();
      for (const [key, val] of idx1) {
        expect(idx2.get(key)).toBe(val);
      }
    });

    it("should include known task types", () => {
      const index = buildTaskTypeIndex();
      expect(index.has("IMPLEMENT_FEATURE")).toBe(true);
      expect(index.has("CODE_REVIEW")).toBe(true);
      expect(index.has("BRAINSTORM")).toBe(true);
      expect(index.has("QUESTION_ANSWER")).toBe(true);
    });
  });

  describe("buildModelIndex", () => {
    it("should create alphabetically sorted index", () => {
      const index = buildModelIndex(["c", "a", "b"]);
      expect(index.get("a")).toBe(0);
      expect(index.get("b")).toBe(1);
      expect(index.get("c")).toBe(2);
    });

    it("should handle empty input", () => {
      const index = buildModelIndex([]);
      expect(index.size).toBe(0);
    });

    it("should handle single model", () => {
      const index = buildModelIndex(["only-one"]);
      expect(index.get("only-one")).toBe(0);
      expect(index.size).toBe(1);
    });
  });

  // ========================================================================
  // Risk 2: MF Learner index integrity
  // ========================================================================

  describe("bidirectional mapping", () => {
    it("should map every task type from DOMAIN_TASK_TYPES to an index", () => {
      const index = buildTaskTypeIndex();
      const domains = Object.keys(DOMAIN_TASK_TYPES) as TaskDomain[];
      for (const domain of domains) {
        for (const taskType of DOMAIN_TASK_TYPES[domain]) {
          expect(index.has(taskType)).toBe(true);
          expect(typeof index.get(taskType)).toBe("number");
        }
      }
    });

    it("should have no duplicate indices in task type index", () => {
      const index = buildTaskTypeIndex();
      const values = [...index.values()];
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it("should produce stable snapshot across rebuilds", () => {
      // Snapshot the first 10 entries (determinism guarantee)
      const idx1 = buildTaskTypeIndex();
      const snapshot = [...idx1.entries()].slice(0, 10);

      const idx2 = buildTaskTypeIndex();
      for (const [key, val] of snapshot) {
        expect(idx2.get(key)).toBe(val);
      }
    });

    it("should map every model ID in input to an index", () => {
      const models = ["openai/gpt-4.1", "anthropic/claude-sonnet-4.6", "google/gemini-2.5-pro"];
      const index = buildModelIndex(models);
      for (const model of models) {
        expect(index.has(model)).toBe(true);
        expect(typeof index.get(model)).toBe("number");
      }
    });

    it("should have no duplicate indices in model index", () => {
      const models = ["z-model", "a-model", "m-model", "a-model"]; // duplicate input
      const index = buildModelIndex(models);
      const values = [...index.values()];
      const uniqueValues = new Set(values);
      expect(uniqueValues.size).toBe(values.length);
    });

    it("should produce contiguous indices [0, N) for model index", () => {
      const models = ["c", "a", "b", "d", "e"];
      const index = buildModelIndex(models);
      const sorted = [...index.values()].sort((a, b) => a - b);
      for (let i = 0; i < sorted.length; i++) {
        expect(sorted[i]).toBe(i);
      }
    });
  });

  describe("constants", () => {
    it("should export pre-built TASK_TYPE_INDEX matching NUM_TASK_TYPES", () => {
      expect(TASK_TYPE_INDEX.size).toBe(NUM_TASK_TYPES);
    });

    it("should export NUM_TASK_TYPES as positive number", () => {
      expect(NUM_TASK_TYPES).toBeGreaterThan(0);
    });
  });
});
