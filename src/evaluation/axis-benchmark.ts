/**
 * Axis 5-slot pipeline benchmark — measures all valid config combinations.
 *
 * Modes:
 *   --mode=dry   Slot 1-4 only (0 LLM calls). Verifies selector ensemble behavior.
 *   --mode=live  Full 5-slot pipeline + LLM judge pairwise comparison.
 *
 * Output: .pyreez/benchmarks/{timestamp}.jsonl
 */

import type {
  AxisConfig,
  ChatFn,
  SlotTrace,
  RunTrace,
  DeliberationResult,
} from "../axis/types";
import { createEngine } from "../axis/factory";
import type { PyreezEngine } from "../axis/engine";

// -- Types --

export interface BenchmarkPrompt {
  text: string;
  domain: string;
  difficulty: "simple" | "complex";
}

export interface BenchmarkRecord {
  config: AxisConfig;
  prompt: BenchmarkPrompt;
  trace: {
    classified: SlotTrace["classified"];
    requirement: SlotTrace["requirement"];
    plan: SlotTrace["plan"];
  };
  result?: DeliberationResult;
  judge?: { score: number; reasoning: string };
  metrics: {
    estimatedCost: number;
    effectiveCost?: number;
    latencyMs: number;
    modelsSelected: number;
  };
}

export interface FileIO {
  mkdir(path: string): Promise<void>;
  appendFile(path: string, data: string): Promise<void>;
}

// -- 12 domains × 2 difficulties = 24 prompts --

export const BENCHMARK_PROMPTS: readonly BenchmarkPrompt[] = [
  // CODING
  { text: "Write a TypeScript debounce function with generics.", domain: "CODING", difficulty: "simple" },
  { text: "Implement a lock-free concurrent queue in TypeScript with backpressure support and work-stealing.", domain: "CODING", difficulty: "complex" },
  // DEBUGGING
  { text: "Find the off-by-one error in this loop: for(let i=0; i<=arr.length; i++)", domain: "DEBUGGING", difficulty: "simple" },
  { text: "Diagnose a memory leak in a Node.js server that only occurs under sustained 10k req/s load with WebSocket connections.", domain: "DEBUGGING", difficulty: "complex" },
  // TESTING
  { text: "Write a unit test for a sum function.", domain: "TESTING", difficulty: "simple" },
  { text: "Design a property-based testing strategy for a distributed consensus algorithm with Byzantine fault tolerance.", domain: "TESTING", difficulty: "complex" },
  // REVIEW
  { text: "Review this function for code style issues.", domain: "REVIEW", difficulty: "simple" },
  { text: "Perform a security audit of an OAuth2 PKCE implementation checking for timing attacks, token leakage, and CSRF vectors.", domain: "REVIEW", difficulty: "complex" },
  // ARCHITECTURE
  { text: "Design a simple REST API for a todo app.", domain: "ARCHITECTURE", difficulty: "simple" },
  { text: "Design a multi-region event-sourced CQRS architecture with exactly-once delivery guarantees and sub-100ms read latency.", domain: "ARCHITECTURE", difficulty: "complex" },
  // DOCUMENTATION
  { text: "Write JSDoc for a greet(name) function.", domain: "DOCUMENTATION", difficulty: "simple" },
  { text: "Create comprehensive API documentation for a GraphQL federation gateway with custom directives, subscriptions, and error taxonomy.", domain: "DOCUMENTATION", difficulty: "complex" },
  // IDEATION
  { text: "Brainstorm names for a CLI tool.", domain: "IDEATION", difficulty: "simple" },
  { text: "Design a novel approach to automated code review that combines static analysis, LLM reasoning, and historical bug patterns.", domain: "IDEATION", difficulty: "complex" },
  // PLANNING
  { text: "Create a checklist for deploying a static site.", domain: "PLANNING", difficulty: "simple" },
  { text: "Plan a zero-downtime migration of a monolithic application to microservices with 99.99% SLA during transition.", domain: "PLANNING", difficulty: "complex" },
  // REQUIREMENTS
  { text: "List requirements for a login page.", domain: "REQUIREMENTS", difficulty: "simple" },
  { text: "Extract and formalize requirements from ambiguous stakeholder interviews for a real-time trading platform with regulatory compliance.", domain: "REQUIREMENTS", difficulty: "complex" },
  // OPERATIONS
  { text: "Write a Dockerfile for a Node.js app.", domain: "OPERATIONS", difficulty: "simple" },
  { text: "Design a Kubernetes operator for auto-scaling GPU workloads with spot instance preemption handling and checkpoint recovery.", domain: "OPERATIONS", difficulty: "complex" },
  // RESEARCH
  { text: "Compare React and Vue for a small project.", domain: "RESEARCH", difficulty: "simple" },
  { text: "Analyze the trade-offs of CRDT vs OT for collaborative editing at scale with offline-first mobile clients.", domain: "RESEARCH", difficulty: "complex" },
  // COMMUNICATION
  { text: "Explain what a closure is in JavaScript.", domain: "COMMUNICATION", difficulty: "simple" },
  { text: "Write a technical RFC proposing a migration from REST to gRPC for inter-service communication with backward compatibility strategy.", domain: "COMMUNICATION", difficulty: "complex" },
];

// -- Valid config combinations --

/** Classifier-profiler pairs that pass the compatibility matrix. */
const VALID_PAIRS: Array<{
  classifier: AxisConfig["classifier"];
  profiler: AxisConfig["profiler"];
}> = [
  { classifier: "keyword", profiler: "domain-override" },
  { classifier: "keyword", profiler: "moe-gating" },
  { classifier: "step-declare", profiler: "step-profile" },
  { classifier: "step-declare", profiler: "moe-gating" },
];

const ALL_SCORINGS: AxisConfig["scoring"][] = ["bt-21", "bt-step"];
const ALL_SELECTORS: AxisConfig["selector"][] = [
  "2track-ce",
  "4strategy",
  "cascade",
  "preference",
  "mab",
];
const ALL_DELIBERATIONS: AxisConfig["deliberation"][] = [
  "role-based",
  "diverge-synth",
  "adp",
  "free-debate",
  "single-best",
];

/** Generate all 200 valid AxisConfig combinations. */
export function generateConfigs(ensembleSize: number = 3): AxisConfig[] {
  const configs: AxisConfig[] = [];
  for (const scoring of ALL_SCORINGS) {
    for (const { classifier, profiler } of VALID_PAIRS) {
      for (const selector of ALL_SELECTORS) {
        for (const deliberation of ALL_DELIBERATIONS) {
          configs.push({
            scoring,
            classifier,
            profiler,
            selector,
            deliberation,
            ensembleSize,
          });
        }
      }
    }
  }
  return configs;
}

// -- Benchmark runner --

export interface BenchmarkRunnerDeps {
  chat?: ChatFn;
  fileIO: FileIO;
  outputDir?: string;
}

export class BenchmarkRunner {
  private readonly chat: ChatFn;
  private readonly fileIO: FileIO;
  private readonly outputDir: string;

  constructor(deps: BenchmarkRunnerDeps) {
    this.chat = deps.chat ?? (() => { throw new Error("No ChatFn for dry mode"); });
    this.fileIO = deps.fileIO;
    this.outputDir = deps.outputDir ?? ".pyreez/benchmarks";
  }

  /** Run dry benchmark: Slot 1-4 only, 0 LLM calls. */
  async runDry(
    configs: AxisConfig[],
    prompts: readonly BenchmarkPrompt[],
  ): Promise<BenchmarkRecord[]> {
    const records: BenchmarkRecord[] = [];
    const outputPath = `${this.outputDir}/${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    await this.fileIO.mkdir(this.outputDir);

    for (const config of configs) {
      const engine = createEngine(config);
      for (const prompt of prompts) {
        const start = performance.now();
        const trace = await engine.traceOnly(prompt.text, { perRequest: 1.0 });
        const latencyMs = performance.now() - start;

        const record: BenchmarkRecord = {
          config,
          prompt,
          trace: {
            classified: trace.classified,
            requirement: trace.requirement,
            plan: trace.plan,
          },
          metrics: {
            estimatedCost: trace.plan.estimatedCost,
            effectiveCost: trace.plan.effectiveCost,
            latencyMs,
            modelsSelected: trace.plan.models.length,
          },
        };

        records.push(record);
        await this.fileIO.appendFile(outputPath, JSON.stringify(record) + "\n");
      }
    }

    return records;
  }

  /** Run live benchmark: full 5-slot pipeline + optional LLM judge. */
  async runLive(
    configs: AxisConfig[],
    prompts: readonly BenchmarkPrompt[],
    judgeFn?: (baseline: DeliberationResult, candidate: DeliberationResult, prompt: BenchmarkPrompt) => Promise<{ score: number; reasoning: string }>,
  ): Promise<BenchmarkRecord[]> {
    const records: BenchmarkRecord[] = [];
    const outputPath = `${this.outputDir}/${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`;
    await this.fileIO.mkdir(this.outputDir);

    // Run baseline (DEFAULT_CONFIG) for judge comparison
    const baselineResults = new Map<string, DeliberationResult>();
    if (judgeFn) {
      const { DEFAULT_CONFIG } = await import("../axis/factory");
      const baseEngine = createEngine(DEFAULT_CONFIG, this.chat);
      for (const prompt of prompts) {
        const result = await baseEngine.run(prompt.text, { perRequest: 1.0 });
        baselineResults.set(prompt.text, result);
      }
    }

    let skipped = 0;
    for (const config of configs) {
      const engine = createEngine(config, this.chat);
      for (const prompt of prompts) {
        try {
          const start = performance.now();
          const runTrace = await engine.runWithTrace(prompt.text, { perRequest: 1.0 });
          const latencyMs = performance.now() - start;

          const record: BenchmarkRecord = {
            config,
            prompt,
            trace: {
              classified: runTrace.classified,
              requirement: runTrace.requirement,
              plan: runTrace.plan,
            },
            result: runTrace.result,
            metrics: {
              estimatedCost: runTrace.plan.estimatedCost,
              effectiveCost: runTrace.plan.effectiveCost,
              latencyMs,
              modelsSelected: runTrace.plan.models.length,
            },
          };

          // Judge if available
          if (judgeFn) {
            const baseline = baselineResults.get(prompt.text);
            if (baseline) {
              record.judge = await judgeFn(baseline, runTrace.result, prompt);
            }
          }

          records.push(record);
          await this.fileIO.appendFile(outputPath, JSON.stringify(record) + "\n");
        } catch (err) {
          skipped++;
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`  [SKIP] ${config.selector}/${prompt.domain}: ${msg.slice(0, 120)}`);
        }
      }
    }
    if (skipped > 0) console.log(`  Skipped ${skipped} runs due to errors.`);

    return records;
  }
}

// -- Sample config selection for live mode --

/** Pick 5 representative configs (one per selector variant). */
export function sampleConfigs(ensembleSize: number = 3): AxisConfig[] {
  return ALL_SELECTORS.map((selector) => ({
    scoring: "bt-21" as const,
    classifier: "keyword" as const,
    profiler: "domain-override" as const,
    selector,
    deliberation: "role-based" as const,
    ensembleSize,
  }));
}

/** Pick 4 prompts: 2 domains × 2 difficulties. */
export const SAMPLE_PROMPTS: readonly BenchmarkPrompt[] = [
  BENCHMARK_PROMPTS[0]!,  // CODING simple
  BENCHMARK_PROMPTS[1]!,  // CODING complex
  BENCHMARK_PROMPTS[8]!,  // ARCHITECTURE simple
  BENCHMARK_PROMPTS[9]!,  // ARCHITECTURE complex
];

// -- Summary printer --

function printSummary(records: BenchmarkRecord[]): void {
  const multiModel = records.filter((r) => r.metrics.modelsSelected > 1).length;
  const singleModel = records.filter((r) => r.metrics.modelsSelected === 1).length;
  const avgLatency = records.reduce((s, r) => s + r.metrics.latencyMs, 0) / records.length;

  const withEffective = records.filter((r) => r.metrics.effectiveCost != null);
  const avgStaticCost = records.reduce((s, r) => s + r.metrics.estimatedCost, 0) / records.length;
  const avgEffectiveCost = withEffective.length > 0
    ? withEffective.reduce((s, r) => s + r.metrics.effectiveCost!, 0) / withEffective.length
    : null;

  console.log(`\n=== Results ===`);
  console.log(`  Total runs: ${records.length}`);
  console.log(`  Multi-model: ${multiModel} (${((multiModel / records.length) * 100).toFixed(1)}%)`);
  console.log(`  Single-model: ${singleModel} (${((singleModel / records.length) * 100).toFixed(1)}%)`);
  console.log(`  Avg latency: ${(avgLatency / 1000).toFixed(2)}s`);
  console.log(`  Avg static cost (per model): $${avgStaticCost.toFixed(6)}`);
  if (avgEffectiveCost != null) {
    // effectiveCost is total across all rounds for all selected models
    // Compare to what it would cost without caching (static × rounds per model)
    const avgStaticMultiRound = withEffective.reduce((s, r) =>
      s + r.metrics.estimatedCost * (r.config.ensembleSize ?? 3), 0) / withEffective.length;
    const savings = ((1 - avgEffectiveCost / avgStaticMultiRound) * 100);
    console.log(`  Avg effective cost (multi-round): $${avgEffectiveCost.toFixed(6)} (${savings.toFixed(1)}% savings from caching)`);
  }

  if (records.some((r) => r.result)) {
    console.log(`\n=== Per-config results ===`);
    const bySelector = new Map<string, BenchmarkRecord[]>();
    for (const r of records) {
      const key = r.config.selector;
      if (!bySelector.has(key)) bySelector.set(key, []);
      bySelector.get(key)!.push(r);
    }

    for (const [selector, recs] of bySelector) {
      const avgModels = recs.reduce((s, r) => s + r.metrics.modelsSelected, 0) / recs.length;
      const avgLat = recs.reduce((s, r) => s + r.metrics.latencyMs, 0) / recs.length;
      const avgLLM = recs.reduce((s, r) => s + (r.result?.totalLLMCalls ?? 0), 0) / recs.length;
      const avgLen = recs.reduce((s, r) => s + (r.result?.result.length ?? 0), 0) / recs.length;
      console.log(`  ${selector}: models=${avgModels.toFixed(1)}, latency=${(avgLat / 1000).toFixed(1)}s, llmCalls=${avgLLM.toFixed(1)}, avgResponseLen=${avgLen.toFixed(0)}`);
    }
  }

  if (records.some((r) => r.judge)) {
    console.log(`\n=== Judge scores ===`);
    const bySelector = new Map<string, number[]>();
    for (const r of records) {
      if (!r.judge) continue;
      const key = r.config.selector;
      if (!bySelector.has(key)) bySelector.set(key, []);
      bySelector.get(key)!.push(r.judge.score);
    }

    for (const [selector, scores] of bySelector) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      const wins = scores.filter((s) => s > 0).length;
      const ties = scores.filter((s) => s === 0).length;
      const losses = scores.filter((s) => s < 0).length;
      console.log(`  ${selector}: avg=${avg.toFixed(2)}, W/T/L=${wins}/${ties}/${losses}`);
    }
  }
}

// -- CLI entry point --

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const modeArg = args.find((a) => a.startsWith("--mode="));
  const mode = modeArg?.split("=")[1] ?? "dry";

  if (mode !== "dry" && mode !== "live" && mode !== "live-sample") {
    console.error('Usage: bun run src/evaluation/axis-benchmark.ts --mode=dry|live-sample|live');
    process.exit(1);
  }

  const bunFileIO: FileIO = {
    mkdir: async (path) => { await Bun.write(`${path}/.keep`, ""); },
    appendFile: async (path, data) => {
      const file = Bun.file(path);
      const existing = await file.exists() ? await file.text() : "";
      await Bun.write(path, existing + data);
    },
  };

  if (mode === "dry") {
    const configs = generateConfigs(3);
    console.log(`Axis benchmark: ${configs.length} configs × ${BENCHMARK_PROMPTS.length} prompts = ${configs.length * BENCHMARK_PROMPTS.length} runs`);
    console.log(`Mode: dry`);

    const runner = new BenchmarkRunner({ fileIO: bunFileIO });
    const start = performance.now();
    const records = await runner.runDry(configs, BENCHMARK_PROMPTS);
    const elapsed = ((performance.now() - start) / 1000).toFixed(2);

    console.log(`\nCompleted ${records.length} runs in ${elapsed}s`);
    printSummary(records);
    return;
  }

  // live or live-sample: requires PAT
  const { loadConfigFromEnv } = await import("../config");
  const { ProviderRegistry } = await import("../llm/registry");
  const { AnthropicProvider } = await import("../llm/providers/anthropic");
  const { ClaudeCliProvider } = await import("../llm/providers/claude-cli");
  const { GoogleProvider } = await import("../llm/providers/google");
  const { OpenAIProvider } = await import("../llm/providers/openai");
  const { createChatAdapter } = await import("../deliberation/wire");

  const appConfig = loadConfigFromEnv();
  const providers: import("../llm/types").LLMProvider[] = [];
  if (appConfig.providers.claudeCli) providers.push(new ClaudeCliProvider());
  else if (appConfig.providers.anthropic) providers.push(new AnthropicProvider(appConfig.providers.anthropic));
  if (appConfig.providers.google) providers.push(new GoogleProvider(appConfig.providers.google));
  if (appConfig.providers.openai) providers.push(new OpenAIProvider(appConfig.providers.openai));
  const { ModelRegistry } = await import("../model/registry");
  const modelReg = new ModelRegistry();
  const providerRegistry = new ProviderRegistry(providers, modelReg.buildProviderMap());
  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));

  const axisChatFn: ChatFn = async (modelId, input) => {
    if (typeof input === "string") {
      return chatAdapter(modelId, [{ role: "user", content: input }]);
    }
    return chatAdapter(modelId, input);
  };

  const configs = mode === "live-sample" ? sampleConfigs(3) : generateConfigs(3);
  const prompts = mode === "live-sample" ? SAMPLE_PROMPTS : BENCHMARK_PROMPTS;

  console.log(`Axis benchmark: ${configs.length} configs × ${prompts.length} prompts = ${configs.length * prompts.length} runs`);
  console.log(`Mode: ${mode}`);

  // Judge function: uses o3 for pairwise comparison
  const judgeFn = async (
    baseline: DeliberationResult,
    candidate: DeliberationResult,
    prompt: BenchmarkPrompt,
  ): Promise<{ score: number; reasoning: string }> => {
    const judgePrompt = [
      { role: "system", content: "You are an impartial judge comparing two AI responses. Score: +1 if Response B is better, -1 if Response A is better, 0 if tied. Respond in JSON: {\"score\": <number>, \"reasoning\": \"<brief>\"}" },
      { role: "user", content: `Task: ${prompt.text}\n\n--- Response A (baseline) ---\n${baseline.result.slice(0, 2000)}\n\n--- Response B (candidate) ---\n${candidate.result.slice(0, 2000)}\n\nWhich response is better? Consider accuracy, completeness, and clarity.` },
    ];
    const raw = await axisChatFn("openai/gpt-4.1", judgePrompt as any);
    try {
      const parsed = JSON.parse(raw);
      return { score: parsed.score ?? 0, reasoning: parsed.reasoning ?? "" };
    } catch {
      return { score: 0, reasoning: `Parse error: ${raw.slice(0, 200)}` };
    }
  };

  const runner = new BenchmarkRunner({ chat: axisChatFn, fileIO: bunFileIO });
  const start = performance.now();
  const records = await runner.runLive(configs, prompts, judgeFn);
  const elapsed = ((performance.now() - start) / 1000).toFixed(2);

  console.log(`\nCompleted ${records.length} runs in ${elapsed}s`);
  printSummary(records);
}

// Only run CLI when executed directly
const isMain = typeof Bun !== "undefined" && Bun.main === import.meta.path;
if (isMain) {
  main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}
