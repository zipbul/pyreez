/**
 * Field Test v2 — Claude CLI + Google Gemini mixed deliberation.
 * Shows every LLM call with full conversation detail.
 */

import { createEngine } from "../src/axis/factory";
import type { AxisConfig, RunTrace, BudgetConfig } from "../src/axis/types";
import type { ChatMessage, ChatCompletionRequest } from "../src/llm/types";
import { ClaudeCliProvider } from "../src/llm/providers/claude-cli";
import { GoogleProvider } from "../src/llm/providers/google";

// --- Load env ---
const dotenv = await Bun.file(".env").text();
const envVars: Record<string, string> = {};
for (const line of dotenv.split("\n")) {
  const [k, ...rest] = line.split("=");
  if (k && rest.length) envVars[k.trim()] = rest.join("=").trim();
}

// --- Providers ---
const claudeProvider = new ClaudeCliProvider();

const googleApiKey = envVars.PYREEZ_GOOGLE_API_KEY;
if (!googleApiKey) throw new Error("PYREEZ_GOOGLE_API_KEY not found in .env");
const googleProvider = new GoogleProvider({ apiKey: googleApiKey });

// --- Models: mixed Claude + Gemini ---
const MODELS = [
  "anthropic/claude-sonnet-4.6",
  "google/gemini-2.5-flash",
  "anthropic/claude-haiku-4.5",
];

const CONFIG: AxisConfig = {
  scoring: "bt-21",
  classifier: "keyword",
  profiler: "domain-override",
  selector: "2track-ce",
  deliberation: "role-based",
  consensus: "leader_decides",
  modelIds: MODELS,
  ensembleSize: 3,
};

const BUDGET: BudgetConfig = { perRequest: 0.50 };

// --- Call Logger ---
interface CallLog {
  idx: number;
  model: string;
  role: string;
  systemSnippet?: string;
  inputSnippet: string;
  response: string;
  latencyMs: number;
}

let callLogs: CallLog[] = [];
let callIdx = 0;

// Infer role from call order within a round (producer=1, reviewer=2, leader=3, repeated)
function inferRole(idx: number): string {
  const pos = ((idx - 1) % 3);
  return pos === 0 ? "producer" : pos === 1 ? "reviewer" : "leader";
}

async function routedChatFn(
  modelId: string,
  input: string | ChatMessage[],
): Promise<string> {
  const messages: ChatMessage[] =
    typeof input === "string"
      ? [{ role: "user", content: input }]
      : input;

  const idx = ++callIdx;
  const shortModel = modelId.replace("anthropic/", "").replace("google/", "");
  const role = inferRole(idx);
  process.stdout.write(`    #${idx} [${role}] ${shortModel}...`);

  const start = performance.now();

  let text: string;
  if (modelId.startsWith("anthropic/")) {
    const res = await claudeProvider.chat({ model: modelId, messages });
    text = res.choices[0]?.message.content ?? "";
  } else if (modelId.startsWith("google/")) {
    const res = await googleProvider.chat({ model: modelId, messages });
    text = res.choices[0]?.message.content ?? "";
  } else {
    throw new Error(`No provider for model: ${modelId}`);
  }

  const latencyMs = Math.round(performance.now() - start);
  console.log(` ${(latencyMs / 1000).toFixed(1)}s (${text.length} chars)`);

  // Extract system/user snippets
  const sys = messages.filter(m => m.role === "system").map(m => m.content ?? "").join(" ").slice(0, 200);
  const usr = messages.filter(m => m.role !== "system").map(m => `[${m.role}] ${(m.content ?? "").slice(0, 150)}`).join("\n    ").slice(0, 400);

  callLogs.push({
    idx, model: shortModel, role,
    systemSnippet: sys || undefined,
    inputSnippet: usr,
    response: text,
    latencyMs,
  });

  return text;
}

// --- Scenarios ---
const SCENARIOS = [
  {
    name: "코드 리뷰 (Claude producer → Gemini reviewer → Claude leader)",
    prompt: `다음 TypeScript 코드를 보안, 타입, 성능 관점에서 리뷰해줘:

\`\`\`typescript
async function fetchUser(id: any) {
  const res = await fetch(\`/api/users/\${id}\`);
  const data = res.json();
  return data;
}
\`\`\``,
  },
  {
    name: "디버깅 (혼합 deliberation)",
    prompt: `다음 에러의 원인과 해결방안을 분석해줘:

TypeError: Cannot read properties of undefined (reading 'chat')
    at ProviderRegistry.chat (registry.ts:30)

환경: PYREEZ_CLAUDE_CLI=1만 설정. google/gemini-2.5-pro 모델 요청시 발생.
ProviderRegistry에 google provider가 등록 안 된 상태.`,
  },
];

// --- Main ---
const engine = createEngine(CONFIG, routedChatFn);

async function main() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║  PYREEZ Field Test — Claude + Gemini Mixed Deliberation  ║");
  console.log("╚════════════════════════════════════════════════════════════╝\n");
  console.log(`Models: ${MODELS.join(", ")}`);
  console.log(`Protocol: role-based (producer → reviewer → leader) × 3 rounds`);
  console.log(`Providers: ClaudeCliProvider (claude -p) + GoogleProvider (API)\n`);

  for (const s of SCENARIOS) {
    callIdx = 0;
    callLogs = [];
    const t0 = performance.now();

    console.log("═".repeat(72));
    console.log(`▸ ${s.name}`);
    console.log("─".repeat(72));

    let trace: RunTrace;
    try {
      trace = await engine.runWithTrace(s.prompt, BUDGET);
    } catch (err) {
      console.log(`\n  ERROR: ${err instanceof Error ? err.message : String(err)}\n`);
      continue;
    }

    const totalMs = Math.round(performance.now() - t0);

    // Pipeline summary
    console.log(`\n  [Pipeline]`);
    console.log(`    Classify:  ${trace.classified.domain}/${trace.classified.taskType} (${trace.classified.complexity})`);
    const topCaps = Object.entries(trace.requirement.capabilities)
      .sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([k, v]) => `${k}=${v.toFixed(2)}`).join(" ");
    console.log(`    Profile:   ${topCaps}`);
    const team = trace.plan.models.map(m =>
      `${m.modelId.replace("anthropic/","").replace("google/","")}(${m.role})`
    ).join(" → ");
    console.log(`    Team:      ${team}`);
    console.log(`    Deliberation: rounds=${trace.result.roundsExecuted} consensus=${trace.result.consensusReached} calls=${trace.result.totalLLMCalls}`);

    // Per-call conversation detail
    console.log(`\n  [Conversation — ${callLogs.length} calls]`);
    for (const log of callLogs) {
      const roundNum = Math.ceil(log.idx / 3);
      console.log(`\n  ┌─ Round ${roundNum} / ${log.role.toUpperCase()} / ${log.model} (${(log.latencyMs / 1000).toFixed(1)}s)`);
      if (log.systemSnippet) {
        console.log(`  │ System: ${log.systemSnippet.slice(0, 120)}...`);
      }
      console.log(`  │ Input:  ${log.inputSnippet.slice(0, 250)}${log.inputSnippet.length > 250 ? "..." : ""}`);
      console.log(`  │`);
      // Show response, indented
      const respLines = log.response.slice(0, 500).split("\n").slice(0, 12);
      for (const line of respLines) {
        console.log(`  │ ${line}`);
      }
      if (log.response.length > 500) console.log(`  │ ...`);
      console.log(`  └─`);
    }

    // Latency breakdown
    const claudeCalls = callLogs.filter(l => l.model.startsWith("claude"));
    const geminiCalls = callLogs.filter(l => l.model.startsWith("gemini"));
    const avgClaude = claudeCalls.length > 0
      ? Math.round(claudeCalls.reduce((a, b) => a + b.latencyMs, 0) / claudeCalls.length)
      : 0;
    const avgGemini = geminiCalls.length > 0
      ? Math.round(geminiCalls.reduce((a, b) => a + b.latencyMs, 0) / geminiCalls.length)
      : 0;

    console.log(`\n  [Latency]`);
    console.log(`    Total: ${(totalMs / 1000).toFixed(1)}s`);
    console.log(`    Claude avg: ${(avgClaude / 1000).toFixed(1)}s/call (${claudeCalls.length} calls)`);
    console.log(`    Gemini avg: ${(avgGemini / 1000).toFixed(1)}s/call (${geminiCalls.length} calls)`);

    // Final result
    console.log(`\n  [Final Result — ${trace.result.result.length} chars]`);
    const lines = trace.result.result.slice(0, 800).split("\n").slice(0, 15);
    for (const line of lines) {
      console.log(`    ${line}`);
    }
    if (trace.result.result.length > 800) console.log("    ...");
    console.log();
  }
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
