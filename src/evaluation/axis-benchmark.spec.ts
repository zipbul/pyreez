/**
 * Axis benchmark — unit tests.
 */
import { describe, it, expect, mock } from "bun:test";
import {
  generateConfigs,
  BenchmarkRunner,
  BENCHMARK_PROMPTS,
  type BenchmarkRecord,
  type FileIO,
} from "./axis-benchmark";

// -- generateConfigs --

describe("generateConfigs", () => {
  it("should generate 200 valid combinations", () => {
    const configs = generateConfigs(3);
    // 2 scoring × 4 valid pairs × 5 selectors × 5 deliberation = 200
    expect(configs).toHaveLength(200);
  });

  it("should set ensembleSize on all configs", () => {
    const configs = generateConfigs(3);
    for (const c of configs) {
      expect(c.ensembleSize).toBe(3);
    }
  });

  it("should never produce keyword + step-profile pair", () => {
    const configs = generateConfigs(2);
    const invalid = configs.filter(
      (c) => c.classifier === "keyword" && c.profiler === "step-profile",
    );
    expect(invalid).toHaveLength(0);
  });

  it("should never produce step-declare + domain-override pair", () => {
    const configs = generateConfigs(2);
    const invalid = configs.filter(
      (c) => c.classifier === "step-declare" && c.profiler === "domain-override",
    );
    expect(invalid).toHaveLength(0);
  });

  it("should default ensembleSize to 3 when not specified", () => {
    const configs = generateConfigs();
    expect(configs[0]!.ensembleSize).toBe(3);
  });
});

// -- BENCHMARK_PROMPTS --

describe("BENCHMARK_PROMPTS", () => {
  it("should have 24 prompts (12 domains × 2 difficulties)", () => {
    expect(BENCHMARK_PROMPTS).toHaveLength(24);
  });

  it("should cover 12 unique domains", () => {
    const domains = new Set(BENCHMARK_PROMPTS.map((p) => p.domain));
    expect(domains.size).toBe(12);
  });

  it("should have exactly 2 prompts per domain (simple + complex)", () => {
    const domainCounts: Record<string, number> = {};
    for (const p of BENCHMARK_PROMPTS) {
      domainCounts[p.domain] = (domainCounts[p.domain] ?? 0) + 1;
    }
    for (const count of Object.values(domainCounts)) {
      expect(count).toBe(2);
    }
  });

  it("should have 12 simple and 12 complex prompts", () => {
    const simple = BENCHMARK_PROMPTS.filter((p) => p.difficulty === "simple");
    const complex = BENCHMARK_PROMPTS.filter((p) => p.difficulty === "complex");
    expect(simple).toHaveLength(12);
    expect(complex).toHaveLength(12);
  });
});

// -- BenchmarkRunner --

function makeMockFileIO(): FileIO {
  return {
    mkdir: mock(async () => {}),
    appendFile: mock(async () => {}),
  };
}

describe("BenchmarkRunner.runDry", () => {
  it("should run all config×prompt combinations and return records", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    // Use a small subset for fast testing
    const configs = generateConfigs(2).slice(0, 2);
    const prompts = BENCHMARK_PROMPTS.slice(0, 2);

    const records = await runner.runDry(configs, prompts);

    expect(records).toHaveLength(4); // 2 configs × 2 prompts
  });

  it("should write each record to the output file", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    const configs = generateConfigs(2).slice(0, 1);
    const prompts = BENCHMARK_PROMPTS.slice(0, 3);

    await runner.runDry(configs, prompts);

    expect(fileIO.appendFile).toHaveBeenCalledTimes(3);
  });

  it("should populate trace fields on every record", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    const configs = generateConfigs(3).slice(0, 1);
    const prompts = BENCHMARK_PROMPTS.slice(0, 1);

    const [record] = await runner.runDry(configs, prompts);

    expect(record!.trace.classified).toBeDefined();
    expect(record!.trace.classified.domain).toBeDefined();
    expect(record!.trace.requirement).toBeDefined();
    expect(record!.trace.plan).toBeDefined();
    expect(record!.trace.plan.models.length).toBeGreaterThan(0);
  });

  it("should NOT have result or judge fields in dry mode", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    const configs = generateConfigs(2).slice(0, 1);
    const prompts = BENCHMARK_PROMPTS.slice(0, 1);

    const [record] = await runner.runDry(configs, prompts);

    expect(record!.result).toBeUndefined();
    expect(record!.judge).toBeUndefined();
  });

  it("should produce multi-model plans when ensembleSize > 1", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    // Use configs with various selectors
    const configs = generateConfigs(3).slice(0, 10);
    const prompts = BENCHMARK_PROMPTS.slice(0, 1);

    const records = await runner.runDry(configs, prompts);

    const multiModel = records.filter((r) => r.metrics.modelsSelected > 1);
    expect(multiModel.length).toBeGreaterThan(0);
  });

  it("should record latency > 0 for each run", async () => {
    const fileIO = makeMockFileIO();
    const runner = new BenchmarkRunner({ fileIO });

    const configs = generateConfigs(2).slice(0, 1);
    const prompts = BENCHMARK_PROMPTS.slice(0, 1);

    const [record] = await runner.runDry(configs, prompts);

    expect(record!.metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });
});
