/**
 * PyreezEngine — 3-stage pipeline tests.
 */
import { describe, it, expect, mock } from "bun:test";
import { PyreezEngine } from "./engine";
import type {
  ScoringSystem,
  Profiler,
  Selector,
  DeliberationProtocol,
  LearningLayer,
} from "./interfaces";
import type {
  ModelScore,
  TaskClassification,
  AxisTaskRequirement,
  EnsemblePlan,
  DeliberationResult,
  BudgetConfig,
  ChatFn,
} from "./types";

// -- Fixtures --

const mockScore: ModelScore = {
  modelId: "test/model-a",
  dimensions: { REASONING: { mu: 700, sigma: 200 } },
  overall: 0.7,
};

const mockClassification: TaskClassification = {
  domain: "CODING",
  taskType: "IMPLEMENT_FEATURE",
  complexity: "simple",
  criticality: "low",
};

const mockReq: AxisTaskRequirement = {
  capabilities: { REASONING: 0.5, CODE_GENERATION: 0.5 },
  constraints: {},
  budget: {},
};

const mockPlanMulti: EnsemblePlan = {
  models: [{ modelId: "test/model-a" }, { modelId: "test/model-b" }],
  strategy: "leader_decides",
  estimatedCost: 0.01,
  reason: "test multi",
};

const mockPlanSingle: EnsemblePlan = {
  models: [{ modelId: "test/model-a" }],
  strategy: "single",
  estimatedCost: 0.005,
  reason: "test single",
};

const mockResult: DeliberationResult = {
  result: "deliberation output",
  roundsExecuted: 1,
  consensusReached: true,
  totalLLMCalls: 3,
  modelsUsed: ["test/model-a", "test/model-b"],
  protocol: "leader_decides",
};

const budget: BudgetConfig = { perRequest: 1.0 };

function makeMocks(planOverride?: EnsemblePlan): {
  scoring: ScoringSystem;
  profiler: Profiler;
  selector: Selector;
  deliberation: DeliberationProtocol;
  chat: ChatFn;
} {
  const plan = planOverride ?? mockPlanMulti;
  return {
    scoring: {
      getScores: mock(async () => [mockScore]),
      update: mock(async () => {}),
    },
    profiler: {
      profile: mock(async () => mockReq),
    },
    selector: {
      select: mock(async () => plan),
    },
    deliberation: {
      deliberate: mock(async () => mockResult),
    },
    chat: mock(async () => ({ content: "chat response", inputTokens: 10, outputTokens: 20 })),
  };
}

// -- Tests --

describe("PyreezEngine", () => {
  describe("run() — 3-stage pipeline", () => {
    it("calls getScores with provided modelIds", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a", "test/model-b"],
      );

      await engine.run("write a function", budget, mockClassification);

      expect(scoring.getScores).toHaveBeenCalledWith([
        "test/model-a",
        "test/model-b",
      ]);
    });

    it("passes classification to profiler", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      await engine.run("write a function", budget, mockClassification);

      expect(profiler.profile).toHaveBeenCalledWith(mockClassification);
    });

    it("passes DeliberationResult through as return value", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const result = await engine.run("write a function", budget, mockClassification);

      expect(result).toBe(mockResult);
    });

    it("skips deliberation and returns single-model result when plan has 1 model", async () => {
      const { scoring, profiler, selector, deliberation, chat } =
        makeMocks(mockPlanSingle);
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const result = await engine.run("simple task", budget, mockClassification);

      expect(deliberation.deliberate).not.toHaveBeenCalled();
      expect(result.protocol).toBe("single");
      expect(result.roundsExecuted).toBe(0);
      expect(result.consensusReached).toBe(true);
      expect(result.modelsUsed).toEqual(["test/model-a"]);
    });

    it("calls learner.enhance() before selector when learner is provided", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const learner: LearningLayer = {
        record: mock(async () => {}),
        enhance: mock(async (scores) => scores),
      };
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
        learner,
      );

      await engine.run("task", budget, mockClassification);

      expect(learner.enhance).toHaveBeenCalledWith(
        [mockScore],
        mockClassification,
      );
    });

    it("calls learner.record() with classified, plan, result after deliberation", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const learner: LearningLayer = {
        record: mock(async () => {}),
        enhance: mock(async (scores) => scores),
      };
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
        learner,
      );

      await engine.run("task", budget, mockClassification);

      expect(learner.record).toHaveBeenCalledWith(
        mockClassification,
        mockPlanMulti,
        mockResult,
      );
    });

    it("does not throw when learner is not provided", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      await expect(engine.run("task", budget, mockClassification)).resolves.toBeDefined();
    });
  });

  describe("traceOnly() — Stage 1-2 only", () => {
    it("should return SlotTrace with scores, classified, requirement, plan", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const trace = await engine.traceOnly("task", budget, mockClassification);

      expect(trace.scores).toEqual([mockScore]);
      expect(trace.classified).toBe(mockClassification);
      expect(trace.requirement).toBe(mockReq);
      expect(trace.plan).toBe(mockPlanMulti);
    });

    it("should NOT call chat or deliberation", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      await engine.traceOnly("task", budget, mockClassification);

      expect(chat).not.toHaveBeenCalled();
      expect(deliberation.deliberate).not.toHaveBeenCalled();
    });

    it("should apply learner.enhance when learner is provided", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const enhancedScore: ModelScore = { ...mockScore, overall: 0.9 };
      const learner: LearningLayer = {
        record: mock(async () => {}),
        enhance: mock(async () => [enhancedScore]),
      };
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
        learner,
      );

      const trace = await engine.traceOnly("task", budget, mockClassification);

      expect(learner.enhance).toHaveBeenCalled();
      expect(trace.scores).toEqual([enhancedScore]);
    });
  });

  describe("runWithTrace() — full pipeline with trace", () => {
    it("should return RunTrace with all SlotTrace fields + result", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const trace = await engine.runWithTrace("task", budget, mockClassification);

      expect(trace.scores).toEqual([mockScore]);
      expect(trace.classified).toBe(mockClassification);
      expect(trace.requirement).toBe(mockReq);
      expect(trace.plan).toBe(mockPlanMulti);
      expect(trace.result).toBe(mockResult);
    });

    it("should use single-model shortcut when plan has 1 model", async () => {
      const { scoring, profiler, selector, deliberation, chat } =
        makeMocks(mockPlanSingle);
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const trace = await engine.runWithTrace("task", budget, mockClassification);

      expect(deliberation.deliberate).not.toHaveBeenCalled();
      expect(trace.result.protocol).toBe("single");
      expect(trace.result.totalLLMCalls).toBe(1);
    });

    it("run() should return same result as runWithTrace().result", async () => {
      const { scoring, profiler, selector, deliberation, chat } = makeMocks();
      const engine = new PyreezEngine(
        scoring,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const result = await engine.run("task", budget, mockClassification);
      expect(result).toBe(mockResult);
    });
  });
});
