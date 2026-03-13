#!/usr/bin/env bun
/**
 * A/B eval: confidence expression vs baseline.
 *
 * Controls:
 *   - Cross-provider team composition (round-robin)
 *   - Cross-provider judge (different provider from team)
 *   - Fixed models across both variants per task
 *   - Position-randomized pairwise judging
 *   - Multiple runs per task for noise reduction
 *
 * Usage: bun run scripts/eval-confidence.ts
 */

import { loadConfigFromEnv, loadRoutingConfig } from "../src/config";
import { createChatAdapter } from "../src/deliberation/wire";
import { deliberate } from "../src/deliberation/engine";
import type { EngineDeps, EngineConfig } from "../src/deliberation/engine";
import { composeTeam, selectDiverseModels } from "../src/deliberation/team-composer";
import {
  buildWorkerMessages,
  buildLeaderMessages,
  buildDebateWorkerMessages,
} from "../src/deliberation/prompts";
import type { GenerationParams } from "../src/deliberation/types";
import type { ChatMessage, LLMProvider, ProviderName } from "../src/llm/types";
import { ProviderRegistry } from "../src/llm/registry";
import { AnthropicProvider } from "../src/llm/providers/anthropic";
import { ClaudeCliProvider } from "../src/llm/providers/claude-cli";
import { GoogleProvider } from "../src/llm/providers/google";
import { LocalProvider } from "../src/llm/providers/local";
import { OpenAICompatibleProvider } from "../src/llm/providers/openai-compatible";
import { XaiProvider } from "../src/llm/providers/xai";
import { ModelRegistry } from "../src/model/registry";
import { filterModelsByProviders } from "../src/index";

// ================================================================
// Config
// ================================================================

const RUNS_PER_TASK = 3;

const EVAL_TASKS: { task: string; nature: "artifact" | "critique" }[] = [
  // Artifact tasks
  {
    task: "Write a Python function that merges two sorted lists into one sorted list. Handle edge cases (empty lists, duplicates, different lengths).",
    nature: "artifact",
  },
  {
    task: "Design a rate limiter middleware for an Express.js API that supports per-user and per-IP limits using a sliding window algorithm. Return the implementation.",
    nature: "artifact",
  },
  {
    task: "Write a TypeScript generic LRU cache class with O(1) get/set, configurable max size, and TTL expiry per entry.",
    nature: "artifact",
  },
  // Critique tasks
  {
    task: "Compare Redis vs Memcached for a session store in a high-traffic web application (100k concurrent users). Consider failover, data persistence, memory efficiency, and operational complexity.",
    nature: "critique",
  },
  {
    task: "Evaluate the tradeoffs of using GraphQL vs REST for a mobile banking application. Consider security, caching, versioning, and developer experience.",
    nature: "critique",
  },
  {
    task: "Analyze whether a microservices architecture is appropriate for a 5-person startup building an MVP e-commerce platform. Consider operational cost, development speed, and scaling needs.",
    nature: "critique",
  },
];

// ================================================================
// Provider setup (mirrors index.ts)
// ================================================================

async function setupProviders() {
  const routing = await loadRoutingConfig();
  const config = loadConfigFromEnv(routing);
  const registry = new ModelRegistry();

  const providers: LLMProvider[] = [];
  if (config.providers.claudeCli) {
    providers.push(new ClaudeCliProvider());
  } else if (config.providers.anthropic) {
    providers.push(new AnthropicProvider(config.providers.anthropic));
  }
  if (config.providers.google) providers.push(new GoogleProvider(config.providers.google));
  if (config.providers.local) providers.push(new LocalProvider(config.providers.local));
  if (config.providers.xai) providers.push(new XaiProvider(config.providers.xai));

  const OPENAI_COMPAT: Record<string, string> = {
    deepseek: "https://api.deepseek.com",
    mistral: "https://api.mistral.ai",
    qwen: "https://dashscope-intl.aliyuncs.com/compatible-mode",
    groq: "https://api.groq.com/openai",
  };
  for (const [name, baseUrl] of Object.entries(OPENAI_COMPAT)) {
    const block = (config.providers as Record<string, unknown>)[name];
    if (block && typeof block === "object" && "apiKey" in (block as Record<string, unknown>)) {
      providers.push(new OpenAICompatibleProvider({ name: name as ProviderName, baseUrl, apiKey: (block as { apiKey: string }).apiKey }));
    }
  }

  const providerRegistry = new ProviderRegistry(providers, registry.buildProviderMap());
  const chatAdapter = createChatAdapter((req) => providerRegistry.chat(req));
  const { modelIds } = filterModelsByProviders(registry, providers);

  return { registry, chatAdapter, modelIds };
}

// ================================================================
// Cross-provider team + judge selection
// ================================================================

function selectCrossProviderTeam(
  registry: ModelRegistry,
  modelIds: string[],
  teamSize: number,
): { teamIds: string[]; judgeId: string } {
  // Use selectDiverseModels for round-robin provider diversity
  const available = modelIds
    .map((id) => registry.getById(id))
    .filter((m): m is NonNullable<typeof m> => m != null);

  const selected = selectDiverseModels(available, teamSize + 1); // +1 for judge
  if (selected.length < teamSize + 1) {
    // Not enough diversity — fall back to best available
    const teamIds = selected.slice(0, teamSize).map((m) => m.id);
    // Judge: first model from a different provider than team
    const teamProviders = new Set(teamIds.map((id) => id.split("/")[0]));
    const judge = available.find((m) => !teamProviders.has(m.id.split("/")[0]) && !teamIds.includes(m.id));
    return { teamIds, judgeId: judge?.id ?? selected[selected.length - 1]!.id };
  }

  const teamIds = selected.slice(0, teamSize).map((m) => m.id);
  const judgeId = selected[teamSize]!.id;
  return { teamIds, judgeId };
}

// ================================================================
// Prompt variant: strip confidence blocks
// ================================================================

function stripConfidence(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((m) => {
    if (m.role === "system" && m.content) {
      let s = m.content;
      s = s.replace(/<confidence>[\s\S]*?<\/confidence>/g, "");
      s = s.replace(/^CONFIDENCE: \[0-10\].*$/gm, "");
      s = s.replace(/\s*Weight (?:worker )?contributions by (?:their )?stated CONFIDENCE scores[^.]*\./g, "");
      return { ...m, content: s.trim() };
    }
    return m;
  });
}

// ================================================================
// LLM-as-Judge
// ================================================================

const JUDGE_PROMPT = `You are an impartial judge. Compare two AI responses to the same task.

<task>{TASK}</task>

<response_a>
{RESPONSE_A}
</response_a>

<response_b>
{RESPONSE_B}
</response_b>

Score each on Correctness, Completeness, Clarity, Insight (0-10 each). Average for final score.
Respond with ONLY this JSON (no other text):
{"a_score": N, "b_score": N, "winner": "A" or "B" or "tie", "reason": "max 15 words"}`;

interface JudgeResult {
  a_score: number;
  b_score: number;
  winner: "A" | "B" | "tie";
  reason: string;
}

type ChatAdapterFn = (model: string, messages: ChatMessage[], params?: GenerationParams) => Promise<{ content: string; inputTokens: number; outputTokens: number }>;

async function judgeOutputs(
  task: string, outputA: string, outputB: string,
  chatAdapter: ChatAdapterFn, judgeModel: string,
): Promise<JudgeResult> {
  const maxLen = 3000;
  const tA = outputA.length > maxLen ? outputA.slice(0, maxLen) + "\n[...truncated]" : outputA;
  const tB = outputB.length > maxLen ? outputB.slice(0, maxLen) + "\n[...truncated]" : outputB;

  const flip = Math.random() > 0.5;
  const prompt = JUDGE_PROMPT
    .replace("{TASK}", task)
    .replace("{RESPONSE_A}", flip ? tB : tA)
    .replace("{RESPONSE_B}", flip ? tA : tB);

  const result = await chatAdapter(judgeModel, [{ role: "user", content: prompt }], { temperature: 0, max_tokens: 256 });

  const unflip = (r: JudgeResult): JudgeResult =>
    flip ? { a_score: r.b_score, b_score: r.a_score, winner: r.winner === "A" ? "B" : r.winner === "B" ? "A" : "tie", reason: r.reason } : r;

  try {
    let raw = result.content.trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();

    // Full JSON
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) {
      try { return unflip(JSON.parse(match[0]) as JudgeResult); } catch { /* fallback */ }
    }

    // Regex fallback
    const aM = raw.match(/"a_score"\s*:\s*([\d.]+)/);
    const bM = raw.match(/"b_score"\s*:\s*([\d.]+)/);
    if (aM && bM) {
      const a = parseFloat(aM[1]!), b = parseFloat(bM[1]!);
      const wM = raw.match(/"winner"\s*:\s*"([^"]+)"/);
      const w: "A" | "B" | "tie" = wM ? (wM[1]!.toUpperCase() === "A" ? "A" : wM[1]!.toUpperCase() === "B" ? "B" : "tie") : (a > b ? "A" : b > a ? "B" : "tie");
      return unflip({ a_score: a, b_score: b, winner: w, reason: "regex fallback" });
    }

    throw new Error("unparseable");
  } catch {
    return { a_score: 0, b_score: 0, winner: "tie", reason: "judge parse failed" };
  }
}

// ================================================================
// Run deliberation
// ================================================================

async function runDeliberation(
  task: string, nature: "artifact" | "critique",
  teamIds: string[],
  registry: { getById: (id: string) => any },
  chatAdapter: ChatAdapterFn,
  variant: "confidence" | "baseline",
): Promise<{ result: string; tokens: { input: number; output: number } }> {
  const models = teamIds.map((id) => registry.getById(id)!).filter(Boolean);
  const team = composeTeam(
    { task, modelIds: teamIds },
    { getModels: () => models, getById: (id: string) => registry.getById(id) },
  );

  const engineDeps: EngineDeps = {
    chat: chatAdapter,
    buildWorkerMessages: variant === "baseline"
      ? (ctx, inst?, ri?, idx?) => stripConfidence(buildWorkerMessages(ctx, inst, ri, idx))
      : buildWorkerMessages,
    buildLeaderMessages: variant === "baseline"
      ? (ctx, inst?, ri?, cons?, proto?) => stripConfidence(buildLeaderMessages(ctx, inst, ri, cons, proto))
      : buildLeaderMessages,
    buildDebateWorkerMessages: variant === "baseline"
      ? (ctx, inst?, ri?, wm?, idx?) => stripConfidence(buildDebateWorkerMessages(ctx, inst, ri, wm, idx))
      : buildDebateWorkerMessages,
  };

  const config: EngineConfig = {
    maxRounds: 1,
    structuralTags: nature === "critique"
      ? ["verification", "adopted", "novel", "result"]
      : undefined,
    workerGenParams: { temperature: 1.0, top_p: 0.9, max_tokens: nature === "artifact" ? 2048 : 1536 },
    leaderGenParams: { temperature: 0.7, ...(nature === "artifact" ? {} : { max_tokens: 8192 }) },
  };

  const output = await deliberate(team, { task, taskNature: nature }, engineDeps, config);
  return { result: output.result, tokens: output.totalTokens };
}

// ================================================================
// Main
// ================================================================

interface TrialResult {
  task: string;
  nature: string;
  run: number;
  teamIds: string[];
  judgeId: string;
  confScore: number;
  baseScore: number;
  winner: "A" | "B" | "tie";
  reason: string;
  confTokens: number;
  baseTokens: number;
}

async function main() {
  console.log("=== Confidence Expression A/B Eval ===");
  console.log(`Tasks: ${EVAL_TASKS.length}, Runs/task: ${RUNS_PER_TASK}\n`);

  const { registry, chatAdapter, modelIds } = await setupProviders();
  console.log(`Available models: ${modelIds.length} (${modelIds.join(", ")})\n`);

  if (modelIds.length < 4) {
    console.error("Need at least 4 models (3 team + 1 judge). Check API keys.");
    process.exit(1);
  }

  const trials: TrialResult[] = [];
  let totalCalls = 0;

  for (const evalTask of EVAL_TASKS) {
    const teamSize = evalTask.nature === "artifact" ? 3 : Math.min(5, modelIds.length - 1);
    const { teamIds, judgeId } = selectCrossProviderTeam(registry, modelIds, teamSize);
    const teamProviders = [...new Set(teamIds.map((id) => id.split("/")[0]))];
    const judgeProvider = judgeId.split("/")[0];

    console.log(`--- ${evalTask.nature.toUpperCase()}: ${evalTask.task.slice(0, 55)}... ---`);
    console.log(`  Team: ${teamIds.join(", ")} (providers: ${teamProviders.join("+")})`);
    console.log(`  Judge: ${judgeId} (provider: ${judgeProvider})`);

    for (let run = 1; run <= RUNS_PER_TASK; run++) {
      process.stdout.write(`  Run ${run}/${RUNS_PER_TASK}: `);

      try {
        process.stdout.write("A...");
        const conf = await runDeliberation(evalTask.task, evalTask.nature, teamIds, registry, chatAdapter, "confidence");
        process.stdout.write("B...");
        const base = await runDeliberation(evalTask.task, evalTask.nature, teamIds, registry, chatAdapter, "baseline");
        process.stdout.write("J...");
        const judge = await judgeOutputs(evalTask.task, conf.result, base.result, chatAdapter, judgeId);

        const tag = judge.winner === "A" ? "CONF" : judge.winner === "B" ? "BASE" : "TIE";
        console.log(` ${tag} (${judge.a_score} vs ${judge.b_score}) — ${judge.reason}`);

        trials.push({
          task: evalTask.task.slice(0, 40),
          nature: evalTask.nature,
          run,
          teamIds,
          judgeId,
          confScore: judge.a_score,
          baseScore: judge.b_score,
          winner: judge.winner,
          reason: judge.reason,
          confTokens: conf.tokens.input + conf.tokens.output,
          baseTokens: base.tokens.input + base.tokens.output,
        });
        totalCalls += 7; // 2 variants × 3 LLM calls + 1 judge
      } catch (err) {
        console.log(` ERROR: ${(err as Error).message}`);
      }
    }
    console.log();
  }

  // ================================================================
  // Summary
  // ================================================================
  console.log("=== RESULTS ===\n");

  const valid = trials.filter((t) => t.confScore > 0 || t.baseScore > 0);
  if (valid.length === 0) {
    console.log("No valid trials. All judge calls failed.");
    return;
  }

  // Per-nature breakdown
  for (const nature of ["artifact", "critique"] as const) {
    const subset = valid.filter((t) => t.nature === nature);
    if (subset.length === 0) continue;

    const confWins = subset.filter((t) => t.winner === "A").length;
    const baseWins = subset.filter((t) => t.winner === "B").length;
    const ties = subset.filter((t) => t.winner === "tie").length;
    const avgConf = subset.reduce((s, t) => s + t.confScore, 0) / subset.length;
    const avgBase = subset.reduce((s, t) => s + t.baseScore, 0) / subset.length;
    const avgConfTok = subset.reduce((s, t) => s + t.confTokens, 0) / subset.length;
    const avgBaseTok = subset.reduce((s, t) => s + t.baseTokens, 0) / subset.length;

    console.log(`[${nature.toUpperCase()}] N=${subset.length}`);
    console.log(`  Confidence wins: ${confWins}  Baseline wins: ${baseWins}  Ties: ${ties}`);
    console.log(`  Avg score: Confidence ${avgConf.toFixed(1)} vs Baseline ${avgBase.toFixed(1)}`);
    console.log(`  Avg tokens: Confidence ${Math.round(avgConfTok)} vs Baseline ${Math.round(avgBaseTok)}`);
    console.log();
  }

  // Overall
  const confWins = valid.filter((t) => t.winner === "A").length;
  const baseWins = valid.filter((t) => t.winner === "B").length;
  const ties = valid.filter((t) => t.winner === "tie").length;
  const avgConf = valid.reduce((s, t) => s + t.confScore, 0) / valid.length;
  const avgBase = valid.reduce((s, t) => s + t.baseScore, 0) / valid.length;

  console.log(`[OVERALL] N=${valid.length}`);
  console.log(`  Confidence wins: ${confWins}  Baseline wins: ${baseWins}  Ties: ${ties}`);
  console.log(`  Win rate: Confidence ${Math.round(confWins / valid.length * 100)}% | Baseline ${Math.round(baseWins / valid.length * 100)}% | Tie ${Math.round(ties / valid.length * 100)}%`);
  console.log(`  Avg score: Confidence ${avgConf.toFixed(1)} vs Baseline ${avgBase.toFixed(1)}`);
  console.log(`  Effect size (score diff): ${(avgConf - avgBase).toFixed(2)}`);
  console.log(`  Total LLM calls: ${totalCalls}`);
}

main().catch((err) => {
  console.error("Eval failed:", err);
  process.exit(1);
});
