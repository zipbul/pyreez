import { describe, it, expect, beforeEach } from "bun:test";
import { FileSkillCellStore, type SkillCellIO } from "./skillcell-store";
import type { FeedbackRecord } from "../axis/types";
import { BINARY_DIMENSIONS, FAILURE_FLAGS } from "../axis/types";

function makeFeedback(overrides?: Partial<FeedbackRecord>): FeedbackRecord {
  return {
    deliberation_id: "delib-1",
    model_id: "test/model-a",
    domain: "ARCHITECTURE",
    task_type: "SYSTEM_DESIGN",
    evaluator_id: "eval-1",
    dimensions: {
      factually_correct: true,
      addresses_task: true,
      provides_evidence: false,
      novel_perspective: true,
      internally_consistent: true,
    },
    failures: {
      hallucination: false,
      refusal: false,
      off_topic: false,
      degenerate: false,
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeIO(): SkillCellIO & { written: string | null } {
  return {
    written: null,
    async readFile() { throw new Error("file not found"); },
    async writeFile(_path: string, data: string) { this.written = data; },
  };
}

describe("FileSkillCellStore", () => {
  let store: FileSkillCellStore;
  let io: ReturnType<typeof makeIO>;

  beforeEach(async () => {
    io = makeIO();
    store = new FileSkillCellStore({ io, path: "test.json" });
    await store.load(); // should not throw on missing file
  });

  it("should return undefined for unknown cell", () => {
    expect(store.get("unknown", "ARCH", "SD")).toBeUndefined();
  });

  it("should create cell on first update with correct alpha/beta", () => {
    store.update(makeFeedback());
    const cell = store.get("test/model-a", "ARCHITECTURE", "SYSTEM_DESIGN");
    expect(cell).toBeDefined();
    expect(cell!.total).toBe(1);
    // factually_correct: pass → alpha=2, beta=1
    expect(cell!.dimensions.factually_correct).toEqual({ alpha: 2, beta: 1 });
    // provides_evidence: fail → alpha=1, beta=2
    expect(cell!.dimensions.provides_evidence).toEqual({ alpha: 1, beta: 2 });
  });

  it("should accumulate multiple updates", () => {
    store.update(makeFeedback());
    store.update(makeFeedback({ dimensions: {
      factually_correct: false,
      addresses_task: true,
      provides_evidence: true,
      novel_perspective: false,
      internally_consistent: true,
    }}));
    const cell = store.get("test/model-a", "ARCHITECTURE", "SYSTEM_DESIGN")!;
    expect(cell.total).toBe(2);
    // factually_correct: 1 pass + 1 fail → alpha=2, beta=2
    expect(cell.dimensions.factually_correct).toEqual({ alpha: 2, beta: 2 });
  });

  it("should track failure counts", () => {
    store.update(makeFeedback({ failures: {
      hallucination: true, refusal: false, off_topic: false, degenerate: false,
    }}));
    store.update(makeFeedback({ failures: {
      hallucination: true, refusal: false, off_topic: true, degenerate: false,
    }}));
    const cell = store.get("test/model-a", "ARCHITECTURE", "SYSTEM_DESIGN")!;
    expect(cell.failure_counts.hallucination).toBe(2);
    expect(cell.failure_counts.off_topic).toBe(1);
    expect(cell.failure_counts.refusal).toBe(0);
  });

  it("should separate cells by domain and task_type", () => {
    store.update(makeFeedback({ domain: "CODING", task_type: "IMPLEMENT_FEATURE" }));
    store.update(makeFeedback({ domain: "RESEARCH", task_type: "TECH_RESEARCH" }));
    expect(store.get("test/model-a", "CODING", "IMPLEMENT_FEATURE")).toBeDefined();
    expect(store.get("test/model-a", "RESEARCH", "TECH_RESEARCH")).toBeDefined();
    expect(store.get("test/model-a", "CODING", "TECH_RESEARCH")).toBeUndefined();
  });

  it("should getAll for domain+taskType", () => {
    store.update(makeFeedback({ model_id: "test/model-a" }));
    store.update(makeFeedback({ model_id: "test/model-b" }));
    store.update(makeFeedback({ model_id: "test/model-c", domain: "CODING", task_type: "X" }));
    const all = store.getAll("ARCHITECTURE", "SYSTEM_DESIGN");
    expect(all).toHaveLength(2);
  });

  it("should getAllForModel across domains", () => {
    store.update(makeFeedback({ domain: "ARCH", task_type: "SD" }));
    store.update(makeFeedback({ domain: "CODE", task_type: "IF" }));
    const all = store.getAllForModel("test/model-a");
    expect(all).toHaveLength(2);
  });

  it("should getAllForFamily", () => {
    const lookup = new Map([["test/model-a", "fam-1"], ["test/model-b", "fam-1"], ["test/model-c", "fam-2"]]);
    store.setFamilyLookup(lookup);
    store.update(makeFeedback({ model_id: "test/model-a" }));
    store.update(makeFeedback({ model_id: "test/model-b" }));
    store.update(makeFeedback({ model_id: "test/model-c" }));
    const fam1 = store.getAllForFamily("fam-1", "ARCHITECTURE", "SYSTEM_DESIGN");
    expect(fam1).toHaveLength(2);
    const fam2 = store.getAllForFamily("fam-2", "ARCHITECTURE", "SYSTEM_DESIGN");
    expect(fam2).toHaveLength(1);
  });

  it("should save and load round-trip", async () => {
    store.update(makeFeedback());
    await store.save();
    expect(io.written).not.toBeNull();

    // Create new store and load from saved data
    const io2: SkillCellIO = {
      async readFile() { return io.written!; },
      async writeFile() {},
    };
    const store2 = new FileSkillCellStore({ io: io2, path: "test.json" });
    await store2.load();

    const cell = store2.get("test/model-a", "ARCHITECTURE", "SYSTEM_DESIGN");
    expect(cell).toBeDefined();
    expect(cell!.total).toBe(1);
    expect(cell!.dimensions.factually_correct).toEqual({ alpha: 2, beta: 1 });
  });

  it("should initialize all dimensions with uniform prior", () => {
    store.update(makeFeedback());
    const cell = store.get("test/model-a", "ARCHITECTURE", "SYSTEM_DESIGN")!;
    for (const dim of BINARY_DIMENSIONS) {
      expect(cell.dimensions[dim]).toBeDefined();
      // alpha + beta should be 3 (1 initial + 1 update)
      expect(cell.dimensions[dim]!.alpha + cell.dimensions[dim]!.beta).toBe(3);
    }
    for (const flag of FAILURE_FLAGS) {
      expect(cell.failure_counts[flag]).toBeDefined();
    }
  });
});
