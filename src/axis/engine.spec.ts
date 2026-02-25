/**
 * PyreezEngine — 5-slot compositor tests.
 */
import { describe, it, expect, mock } from "bun:test";
import { PyreezEngine } from "./engine";
import type {
  ScoringSystem,
  Classifier,
  Profiler,
  Selector,
  DeliberationProtocol,
  LearningLayer,
} from "./interfaces";
import type {
  ModelScore,
  ClassifyOutput,
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

const mockClassified: ClassifyOutput = {
  domain: "CODING",
  taskType: "IMPLEMENT_FEATURE",
  vocabKind: "taskType",
  complexity: "simple",
  criticality: "low",
  method: "rule",
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
const chatFn: ChatFn = mock(async () => "chat response");

function makeMocks(planOverride?: EnsemblePlan): {
  scoring: ScoringSystem;
  classifier: Classifier;
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
    classifier: {
      classify: mock(async () => mockClassified),
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
    chat: mock(async () => "chat response"),
  };
}

// -- Tests --

describe("PyreezEngine", () => {
  describe("run() — 5-slot pipeline", () => {
    it("calls getScores with provided modelIds", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a", "test/model-b"],
      );

      await engine.run("write a function", budget);

      expect(scoring.getScores).toHaveBeenCalledWith([
        "test/model-a",
        "test/model-b",
      ]);
    });

    it("passes classified output to profiler", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      await engine.run("write a function", budget);

      expect(profiler.profile).toHaveBeenCalledWith(mockClassified);
    });

    it("passes DeliberationResult through as return value", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const result = await engine.run("write a function", budget);

      expect(result).toBe(mockResult);
    });

    it("skips deliberation and returns single-model result when plan has 1 model", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks(mockPlanSingle);
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      const result = await engine.run("simple task", budget);

      expect(deliberation.deliberate).not.toHaveBeenCalled();
      expect(result.protocol).toBe("single");
      expect(result.roundsExecuted).toBe(0);
      expect(result.consensusReached).toBe(true);
      expect(result.modelsUsed).toEqual(["test/model-a"]);
    });

    it("calls learner.enhance() before selector when learner is provided", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const learner: LearningLayer = {
        record: mock(async () => {}),
        enhance: mock(async (scores) => scores),
      };
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
        learner,
      );

      await engine.run("task", budget);

      expect(learner.enhance).toHaveBeenCalledWith(
        [mockScore],
        mockClassified,
      );
    });

    it("calls learner.record() with classified, plan, result after deliberation", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const learner: LearningLayer = {
        record: mock(async () => {}),
        enhance: mock(async (scores) => scores),
      };
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
        learner,
      );

      await engine.run("task", budget);

      // record is called (fire-and-forget)
      expect(learner.record).toHaveBeenCalledWith(
        mockClassified,
        mockPlanMulti,
        mockResult,
      );
    });

    it("does not throw when learner is not provided", async () => {
      const { scoring, classifier, profiler, selector, deliberation, chat } =
        makeMocks();
      const engine = new PyreezEngine(
        scoring,
        classifier,
        profiler,
        selector,
        deliberation,
        chat,
        ["test/model-a"],
      );

      await expect(engine.run("task", budget)).resolves.toBeDefined();
    });
  });
});
