/**
 * Pyreez CLI entry point.
 * Subcommands: scores, deliberate, acceptance, feedback
 *
 * Usage:
 *   bun run src/cli.ts scores
 *   bun run src/cli.ts deliberate --task "..." --models "A,B"
 *   bun run src/cli.ts acceptance --task "..." --synthesis "..." --workers '[...]'
 *   bun run src/cli.ts feedback --evaluations '[...]'
 */

import { Anonymizer, emptyAnonymizationState } from "./handlers";
import type { AnonymizationState } from "./handlers";
import type { HandlersConfig } from "./handlers";
import { handleDeliberate, handleAcceptance } from "./handlers";
import {
  AnonymizationStateSchema,
  CooldownStateSchema,
  AcceptanceWorkersArraySchema,
  parseWithSchema,
} from "./validation/schemas";

// -- Session persistence --

const SESSION_PATH = ".pyreez/session.json";

async function loadSession(): Promise<AnonymizationState> {
  try {
    const file = Bun.file(SESSION_PATH);
    if (await file.exists()) {
      const result = parseWithSchema(await file.text(), AnonymizationStateSchema, "session.json");
      if (result.success) return result.data;
      console.error(`[pyreez] ${result.error} — starting fresh session`);
    }
  } catch {
    // corrupt or missing — start fresh
  }
  return emptyAnonymizationState();
}

async function saveSession(state: AnonymizationState): Promise<void> {
  await Bun.write(SESSION_PATH, JSON.stringify(state, null, 2));
}

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

/** Read value from flag or stdin if value is "-". */
async function resolveValue(value: string | undefined): Promise<string | undefined> {
  if (value === undefined) return undefined;
  if (value === "-") {
    // Read from stdin
    const chunks: Uint8Array[] = [];
    const reader = Bun.stdin.stream().getReader();
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) break;
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString("utf-8").trim();
  }
  return value;
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function printUsage(): never {
  console.error(`Usage: bun run src/cli.ts <command> [options]

Commands:
  scores       Get model scores for a domain
  deliberate   Run multi-model deliberation
  acceptance   Verify a synthesis against worker positions
  feedback     Submit per-model evaluations

Run "bun run src/cli.ts <command> --help" for command-specific help.`);
  process.exit(1);
}

// -- Wiring (same as index.ts) --

async function buildConfig(anonymizer: Anonymizer): Promise<HandlersConfig> {
  const { loadConfigFromEnv, loadRoutingConfig } = await import("./config");
  const { createChatAdapter, createDeliberateFn } = await import("./deliberation/wire");
  const { FileDeliberationStore } = await import("./deliberation/file-store");
  const { ProviderRegistry } = await import("./llm/registry");
  const { ClaudeCliProvider } = await import("./llm/providers/claude-cli");
  const { GeminiCliProvider } = await import("./llm/providers/gemini-cli");
  const { CodexCliProvider } = await import("./llm/providers/codex-cli");
  const { XaiProvider } = await import("./llm/providers/xai");
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

  // Build providers
  const providers: import("./llm/types").LLMProvider[] = [];
  providers.push(new ClaudeCliProvider());
  providers.push(new GeminiCliProvider());
  providers.push(new CodexCliProvider());
  if (config.providers.xai) {
    providers.push(new XaiProvider(config.providers.xai));
  }

  const providerRegistry = new ProviderRegistry(
    providers,
    registry.buildProviderMap(),
  );

  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));

  const { modelIds, warnings } = filterModelsByProviders(registry, providers);
  for (const w of warnings) console.error(`[pyreez] ${w}`);
  if (modelIds.length === 0) {
    die("[pyreez] No models available. Check API keys and scores/models.json.");
  }

  const sharedCooldown = createCooldownManager();

  // Restore cooldown state
  const COOLDOWN_PATH = "scores/cooldown.json";
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
    anonymizer,
  };
}

// -- Main --

async function main(): Promise<void> {
  const { command, flags } = parseArgs(process.argv);

  if (!command || command === "help" || command === "--help") {
    printUsage();
  }

  const sessionState = await loadSession();
  const anonymizer = new Anonymizer(sessionState);

  const config = await buildConfig(anonymizer);

  let result: import("./handlers").HandlerResult;

  switch (command) {
    case "deliberate": {
      const task = await resolveValue(flags["task"]);
      if (!task) die("--task is required for deliberate");
      const modelsRaw = flags["models"];
      if (!modelsRaw) die("--models is required for deliberate");
      const models = modelsRaw!.split(",").map((s) => s.trim());
      const workerInstructions = await resolveValue(flags["worker-instructions"]);

      result = await handleDeliberate(config, {
        task: task!,
        models,
        count: flags["count"] !== undefined ? Number(flags["count"]) : undefined,
        worker_instructions: workerInstructions,
        max_rounds: flags["max-rounds"] !== undefined ? Number(flags["max-rounds"]) : undefined,
        protocol: flags["protocol"],
        technique: flags["technique"]?.includes(",")
          ? flags["technique"].split(",").map((s) => s.trim())
          : flags["technique"],
        onRound: (round) => {
          const models = round.responses.map((r) => r.model).join(", ");
          const failed = round.failedWorkers?.length ?? 0;
          console.error(`[pyreez] round ${round.number}: ${round.responses.length} responses (${models})${failed ? `, ${failed} failed` : ""}`);
        },
      });
      break;
    }

    case "acceptance": {
      const task = await resolveValue(flags["task"]);
      if (!task) die("--task is required for acceptance");
      const synthesis = await resolveValue(flags["synthesis"]);
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

    default:
      die(`Unknown command: ${command}. Run without arguments for usage.`);
  }

  // Save session after every command
  await saveSession(config.anonymizer.serialize());

  if (result!.error) {
    console.error(result!.error);
    process.exit(1);
  }

  console.log(JSON.stringify(result!.data, null, 2));
}

main().catch((error) => {
  console.error("Pyreez CLI failed:", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
