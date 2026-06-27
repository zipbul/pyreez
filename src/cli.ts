/**
 * Pyreez CLI entry point.
 * Subcommands: deliberate, acceptance
 *
 * Usage:
 *   bun run src/cli.ts deliberate --task "..." --models "model1,model2"
 *   bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[...]'
 */

import type { HandlersConfig } from "./handlers";
import { handleDeliberate, handleAcceptance } from "./handlers";
import { CooldownStateSchema, AcceptanceWorkersArraySchema, parseWithSchema } from "./validation/schemas";

// -- Arg parsing --

function parseArgs(argv: string[]): { command: string; flags: Record<string, string> } {
  // argv: [bun, script, command, ...flags]
  const command = argv[2] ?? "";
  const flags: Record<string, string> = {};
  for (let i = 3; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return { command, flags };
}

/** Read all of stdin to a trimmed string. The stream is consumed exactly once. */
async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  const reader = Bun.stdin.stream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString("utf-8").trim();
}

/** Flag names whose values are user content and may be piped from stdin via "-". */
const STDIN_FLAGS = [
  "task", "worker-instructions", "criteria", "subject", "questions",
  "synthesis", "candidates", "responses", "deliberate",
] as const;

/**
 * Resolve the stdin pipe ("-") into its owning flag, mutating `flags` in place.
 * stdin can be read only once, so at most one flag may use "-"; more than one is rejected
 * rather than silently dropped or crashed.
 * @param reader injectable for tests; defaults to reading process stdin once.
 */
export async function resolveStdinFlags(
  flags: Record<string, string>,
  reader: () => Promise<string> = readStdin,
): Promise<void> {
  const piped = STDIN_FLAGS.filter((name) => flags[name] === "-");
  if (piped.length === 0) return;
  if (piped.length > 1) {
    throw new Error(
      `Only one flag may read from stdin ("-") per invocation; got: ${piped.map((f) => "--" + f).join(", ")}`,
    );
  }
  flags[piped[0]!] = await reader();
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function printUsage(): never {
  console.error(`Usage: bun run src/cli.ts <command> [options]

Commands:
  models       List available models with benchmark scores
  deliberate   Run multi-model deliberation
  acceptance   Verify a synthesis against worker positions
  rank         Pairwise-rank candidate responses with an LLM judge (LLM-Blender pattern)
  quality-check  Cross-validate factual claims across responses (FActScore-inspired)
  convergence-check  LLM-judge semantic convergence across responses (HIGH/MODERATE/DIVERSE)
  inspect       Integrated post-deliberate inspection: convergence + (rank if N≥4) + quality (opt-in)
  fuse          Fuse ranked candidates into a single synthesis draft (LLM-Blender GenFuser)

Run "bun run src/cli.ts <command> --help" for command-specific help.`);
  process.exit(1);
}

// -- Wiring (same as index.ts) --

async function buildConfig(): Promise<HandlersConfig> {
  const { loadConfigFromEnv, loadRoutingConfig } = await import("./config");
  const { createChatAdapter, createDeliberateFn } = await import("./deliberation/wire");
  const { FileDeliberationStore } = await import("./deliberation/file-store");
  const { ProviderRegistry } = await import("./llm/registry");
  const { buildProviders } = await import("./llm/providers");
  const { ModelRegistry } = await import("./model/registry");
  const { BunFileIO } = await import("./report/bun-file-io");
  const { FileRunLogger } = await import("./report/run-logger");
  const { createCooldownManager } = await import("./deliberation/cooldown");
  const { filterModelsByProviders } = await import("./index");

  const routing = await loadRoutingConfig();
  const config = loadConfigFromEnv(routing);
  const registry = new ModelRegistry();
  const fileIO = new BunFileIO();
  const deliberationStore = new FileDeliberationStore(".pyreez/deliberations", fileIO);
  const runLogger = new FileRunLogger(".pyreez/runs", fileIO);

  // Build providers (single registration point)
  const providers = buildProviders(config.providers);

  const providerRegistry = new ProviderRegistry(
    providers,
    registry.buildProviderMap(),
  );

  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));

  const { modelIds, warnings } = filterModelsByProviders(registry, providers);
  for (const w of warnings) console.error(`[pyreez] ${w}`);
  if (modelIds.length === 0) {
    die("[pyreez] No models available. Check API keys and .pyreez/models.jsonc.");
  }

  const sharedCooldown = createCooldownManager();

  // Restore cooldown state
  const COOLDOWN_PATH = ".pyreez/cooldown.json";
  try {
    const raw = await fileIO.readFile(COOLDOWN_PATH);
    const result = parseWithSchema(raw, CooldownStateSchema, "cooldown.json");
    if (result.success) {
      sharedCooldown.restore(result.data);
    } else {
      console.error(`[pyreez] ${result.error}`);
    }
  } catch {
    // No persisted state
  }

  const configuredModelIds = new Set(modelIds);
  const filteredRegistry = {
    getAll: () => registry.getAll().filter((m) => configuredModelIds.has(m.id)),
    getAvailable: () => registry.getAvailable().filter((m) => configuredModelIds.has(m.id)),
    getById: (id: string) => configuredModelIds.has(id) ? registry.getById(id) : undefined,
  };

  const deliberateFn = createDeliberateFn({
    registry: filteredRegistry,
    chat: (model, messages, params) => chatAdapter(model, messages, params),
    store: deliberationStore,
    cooldown: sharedCooldown,
  });

  return {
    filteredRegistry,
    deliberateFn,
    runLogger,
    chatFn: (model, messages, params) => chatAdapter(model, messages, params),
  };
}

// -- Main --

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  if (!command || command === "help" || command === "--help") {
    printUsage();
  }

  // Resolve a single stdin pipe ("-") into its flag before dispatch. Reads stdin once; rejects
  // more than one "-" flag. After this, flags hold literal content and no command re-reads stdin.
  await resolveStdinFlags(flags);

  const config = await buildConfig();

  let result: import("./handlers").HandlerResult;

  switch (command) {
    case "models": {
      const reg = config.filteredRegistry;
      if (!reg) die("Registry not available");
      const available = reg.getAvailable();
      const models = available.map((m) => ({
        id: m.id,
        provider: m.provider,
        family: m.family,
        contextWindow: m.contextWindow,
        cost: m.cost,
        ...(m.benchmark ? { benchmark: m.benchmark } : {}),
      }));
      result = { data: { models, total: models.length } };
      break;
    }

    case "deliberate": {
      const task = flags["task"];
      if (!task) die("--task is required for deliberate");
      const modelsRaw = flags["models"];
      if (!modelsRaw) die("--models is required for deliberate");
      const models = modelsRaw!.split(",").map((s) => s.trim());
      const workerInstructions = flags["worker-instructions"];
      // criteria/subject/questions are user content and must support stdin ("-") like task does.
      const criteria = flags["criteria"];
      const subject = flags["subject"];
      const questionsRaw = flags["questions"];
      // Vendor reasoning-effort: the sanctioned depth lever (claude --effort / codex model_reasoning_effort).
      // Caller opt-in only — no baked default. e.g. --reasoning-effort high for deep stress-tests.
      const VALID_EFFORTS = new Set(["minimal", "low", "medium", "high", "xhigh"]);
      const reasoningEffort = flags["reasoning-effort"];
      if (reasoningEffort !== undefined && !VALID_EFFORTS.has(reasoningEffort)) {
        die(`--reasoning-effort must be one of: minimal, low, medium, high, xhigh`);
      }

      result = await handleDeliberate(config, {
        task: task!,
        models,
        count: flags["count"] !== undefined ? Number(flags["count"]) : undefined,
        worker_instructions: workerInstructions,
        max_rounds: flags["max-rounds"] !== undefined ? Number(flags["max-rounds"]) : undefined,
        protocol: flags["protocol"],
        questions: questionsRaw?.split(",").map((s) => s.trim()),
        criteria,
        subject,
        aggregation: flags["aggregation"],
        file_access: flags["file-access"] === "true" ? true : undefined,
        web_access: flags["web-access"] === "true" ? true : undefined,
        reasoning_effort: reasoningEffort as import("./deliberation/types").ReasoningEffort | undefined,
        onRound: (round) => {
          const models = round.responses.map((r) => r.model).join(", ");
          const failed = round.failedWorkers?.length ?? 0;
          console.error(`[pyreez] round ${round.number}: ${round.responses.length} responses (${models})${failed ? `, ${failed} failed` : ""}`);
        },
      });
      break;
    }

    case "acceptance": {
      const task = flags["task"];
      if (!task) die("--task is required for acceptance");
      const synthesis = flags["synthesis"];
      if (!synthesis) die("--synthesis is required for acceptance");
      const workersRaw = flags["workers"];
      if (!workersRaw) die("--workers is required for acceptance (JSON array)");
      const workersResult = parseWithSchema(workersRaw!, AcceptanceWorkersArraySchema, "--workers");
      if (!workersResult.success) die(workersResult.error);

      result = await handleAcceptance(config, {
        task: task!,
        synthesis: synthesis!,
        workers: workersResult.data!,
      });
      break;
    }

    case "rank": {
      const task = flags["task"];
      if (!task) die("--task is required for rank");
      const candidatesRaw = flags["candidates"];
      if (!candidatesRaw) die("--candidates is required (JSON array: [{id, content}, ...])");
      const judgeModel = flags["judge"];
      if (!judgeModel) die("--judge is required (model id, e.g. openai/gpt-5.4-mini)");

      let candidates: { id: string; content: string }[];
      try {
        const parsed = JSON.parse(candidatesRaw!);
        if (!Array.isArray(parsed)) throw new Error("candidates must be a JSON array");
        candidates = parsed.map((c, i) => {
          if (typeof c?.id !== "string" || typeof c?.content !== "string") {
            throw new Error(`candidates[${i}] missing id or content`);
          }
          return { id: c.id, content: c.content };
        });
      } catch (err) {
        die(`--candidates parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const { rankByPairwise } = await import("./synthesis/pairranker");
      const { createLLMJudge } = await import("./synthesis/llm-judge");
      if (!config.chatFn) die("chat function not available");
      const lazy = flags["lazy"] === "true";
      const judge = createLLMJudge(judgeModel!, async (model, messages) => {
        const r = await config.chatFn!(model, messages);
        return { content: r.content };
      }, lazy ? { positionBias: "lazy" } : undefined);
      const ranking = await rankByPairwise(task!, candidates!, judge);
      result = { data: ranking };
      break;
    }

    case "quality-check": {
      const responsesRaw = flags["responses"];
      if (!responsesRaw) die("--responses is required (JSON array: [{id, content}, ...])");
      const judgeModel = flags["judge"];
      if (!judgeModel) die("--judge is required (model id)");

      let responses: { id: string; content: string }[];
      try {
        const parsed = JSON.parse(responsesRaw!);
        if (!Array.isArray(parsed)) throw new Error("responses must be a JSON array");
        responses = parsed.map((r, i) => {
          if (typeof r?.id !== "string" || typeof r?.content !== "string") {
            throw new Error(`responses[${i}] missing id or content`);
          }
          return { id: r.id, content: r.content };
        });
      } catch (err) {
        die(`--responses parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const { crossValidate } = await import("./quality/cross-validate");
      const { createLLMCrossValidator } = await import("./quality/llm-cross-validator");
      if (!config.chatFn) die("chat function not available");
      const judge = createLLMCrossValidator(judgeModel!, async (model, messages) => {
        const r = await config.chatFn!(model, messages);
        return { content: r.content };
      });
      const findings = await crossValidate(responses!, judge);
      result = { data: findings };
      break;
    }

    case "convergence-check": {
      const task = flags["task"];
      if (!task) die("--task is required for convergence-check");
      const responsesRaw = flags["responses"];
      if (!responsesRaw) die("--responses is required (JSON array: [{id, content}, ...])");
      const judgeModel = flags["judge"];
      if (!judgeModel) die("--judge is required (model id)");

      let responses: { id: string; content: string }[];
      try {
        const parsed = JSON.parse(responsesRaw!);
        if (!Array.isArray(parsed)) throw new Error("responses must be a JSON array");
        responses = parsed.map((r, i) => {
          if (typeof r?.id !== "string" || typeof r?.content !== "string") {
            throw new Error(`responses[${i}] missing id or content`);
          }
          return { id: r.id, content: r.content };
        });
      } catch (err) {
        die(`--responses parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const { judgeConvergence } = await import("./quality/convergence-judge");
      if (!config.chatFn) die("chat function not available");
      const verdict = await judgeConvergence(judgeModel!, async (model, messages) => {
        const r = await config.chatFn!(model, messages);
        return { content: r.content };
      }, task!, responses!);
      result = { data: verdict };
      break;
    }

    case "inspect": {
      const task = flags["task"];
      if (!task) die("--task is required for inspect");
      const deliberateRaw = flags["deliberate"];
      if (!deliberateRaw) die("--deliberate is required (path or '-' for stdin: full deliberate JSON output)");
      const judgeModel = flags["judge"];
      if (!judgeModel) die("--judge is required (model id)");
      const factualLikely = flags["factual"] === "true";
      const skipConvergence = flags["skip-convergence"] === "true";

      let deliberate: any;
      try {
        deliberate = JSON.parse(deliberateRaw!);
      } catch (err) {
        die(`--deliberate parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      const { runInspection } = await import("./inspect/inspect");
      if (!config.chatFn) die("chat function not available");
      const inspection = await runInspection({
        task: task!,
        deliberate,
        judgeModel: judgeModel!,
        chat: async (model, messages) => {
          const r = await config.chatFn!(model, messages);
          return { content: r.content };
        },
        factualLikely,
        skipConvergence,
      });
      result = { data: inspection };
      break;
    }

    case "fuse": {
      const task = flags["task"];
      if (!task) die("--task is required for fuse");
      const candidatesRaw = flags["candidates"];
      if (!candidatesRaw) die("--candidates is required (JSON array: [{id, content}, ...])");
      const judgeModel = flags["judge"];
      if (!judgeModel) die("--judge is required (model id)");
      const rankingRaw = flags["ranking"];

      let candidates: { id: string; content: string }[];
      try {
        const parsed = JSON.parse(candidatesRaw!);
        if (!Array.isArray(parsed)) throw new Error("candidates must be a JSON array");
        candidates = parsed.map((c, i) => {
          if (typeof c?.id !== "string" || typeof c?.content !== "string") {
            throw new Error(`candidates[${i}] missing id or content`);
          }
          return { id: c.id, content: c.content };
        });
      } catch (err) {
        die(`--candidates parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }

      let ranking: { id: string; wins: number; losses: number }[] | undefined;
      if (rankingRaw) {
        try {
          const parsed = JSON.parse(rankingRaw);
          if (!Array.isArray(parsed)) throw new Error("ranking must be a JSON array");
          ranking = parsed;
        } catch (err) {
          die(`--ranking parse failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

      const { fuseCandidates } = await import("./synthesis/fuser");
      if (!config.chatFn) die("chat function not available");
      const fuseResult = await fuseCandidates(
        judgeModel!,
        async (model, messages) => {
          const r = await config.chatFn!(model, messages);
          return { content: r.content };
        },
        task!,
        candidates!,
        ranking ? { ranking } : undefined,
      );
      result = { data: fuseResult };
      break;
    }

    default:
      die(`Unknown command: ${command}. Run without arguments for usage.`);
  }

  if (result!.error) {
    console.error(result!.error);
    process.exit(1);
  }

  console.log(JSON.stringify(result!.data, null, 2));
}

if (import.meta.main) {
  main().catch((error) => {
    console.error("Pyreez CLI failed:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
