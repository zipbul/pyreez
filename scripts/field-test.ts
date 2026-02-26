/**
 * Field Test — Full 5-slot pipeline with ClaudeCliProvider.
 *
 * Runs real prompts through: Classify → Profile → Score → Select → Deliberate
 * All LLM calls go through `claude -p` (Claude Code subscription, $0 extra).
 *
 * Usage: bun run scripts/field-test.ts
 */

import { createEngine } from "../src/axis/factory";
import type { AxisConfig, RunTrace, BudgetConfig } from "../src/axis/types";
import type { ChatMessage } from "../src/llm/types";
import {
  ClaudeCliProvider,
  serializeMessages,
  toCliModelId,
} from "../src/llm/providers/claude-cli";

// --- Config ---

const CLAUDE_MODELS = [
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
];

const ENGINE_CONFIG: AxisConfig = {
  scoring: "bt-21",
  classifier: "keyword",
  profiler: "domain-override",
  selector: "2track-ce",
  deliberation: "role-based",
  consensus: "leader_decides",
  modelIds: CLAUDE_MODELS,
  ensembleSize: 3, // role-based needs producer + reviewer + leader
};

const BUDGET: BudgetConfig = { perRequest: 0.50 };

// --- ChatFn via ClaudeCliProvider ---

const cliProvider = new ClaudeCliProvider();

async function chatFn(
  modelId: string,
  input: string | ChatMessage[],
): Promise<string> {
  const messages: ChatMessage[] =
    typeof input === "string"
      ? [{ role: "user", content: input }]
      : input;

  const response = await cliProvider.chat({
    model: modelId,
    messages,
  });

  return response.choices[0]?.message.content ?? "";
}

// --- Test Scenarios ---

interface Scenario {
  name: string;
  prompt: string;
  hints?: { domain_hint?: string };
  /** Quick quality check keywords */
  expectContains?: string[];
}

const SCENARIOS: Scenario[] = [
  {
    name: "코드 리뷰 (REVIEW)",
    prompt: `다음 TypeScript 코드를 리뷰해줘. 보안, 성능, 타입 안전성 관점에서 분석해줘.

\`\`\`typescript
async function fetchUser(id: any) {
  const res = await fetch(\`/api/users/\${id}\`);
  const data = res.json();
  return data;
}
\`\`\``,
    expectContains: ["any", "await"],
  },
  {
    name: "아키텍처 설계 (ARCHITECTURE)",
    prompt:
      "TypeScript MCP 서버에서 rate limiting을 구현하려고 해. Token bucket vs Sliding window 중 어떤 알고리즘이 적합한지, 그리고 멀티 프로바이더 환경에서 프로바이더별 독립 rate limit을 어떻게 관리할지 설계해줘.",
    expectContains: ["token", "rate"],
  },
  {
    name: "디버깅 분석 (DEBUGGING)",
    prompt: `이 에러 로그를 분석해서 원인과 해결방안을 알려줘:

TypeError: Cannot read properties of undefined (reading 'chat')
    at ProviderRegistry.chat (src/llm/registry.ts:30)
    at createChatAdapter (src/deliberation/wire.ts:120)
    at PyreezMcpServer.handleAsk (src/mcp/server.ts:45)

환경: Bun 1.3, TypeScript strict mode. PYREEZ_GITHUB_PAT만 설정된 상태.`,
    expectContains: ["provider", "model"],
  },
  {
    name: "알고리즘 구현 (CODING)",
    prompt:
      "Bradley-Terry 모델의 온라인 업데이트 함수를 TypeScript로 구현해줘. mu/sigma 파라미터를 가진 두 모델의 rating을 pairwise 결과로 업데이트하는 함수야. sigma는 비교 횟수에 따라 수렴해야해.",
    expectContains: ["mu", "sigma"],
  },
];

// --- Runner ---

interface FieldResult {
  scenario: string;
  trace: RunTrace;
  latencyMs: number;
  qualityCheck: { passed: boolean; missing: string[] };
}

async function runScenario(s: Scenario): Promise<FieldResult> {
  const start = performance.now();
  const trace = await engine.runWithTrace(s.prompt, BUDGET, s.hints);
  const latencyMs = Math.round(performance.now() - start);

  const missing: string[] = [];
  if (s.expectContains) {
    const lower = trace.result.result.toLowerCase();
    for (const kw of s.expectContains) {
      if (!lower.includes(kw.toLowerCase())) {
        missing.push(kw);
      }
    }
  }

  return {
    scenario: s.name,
    trace,
    latencyMs,
    qualityCheck: { passed: missing.length === 0, missing },
  };
}

// --- Report ---

function printReport(results: FieldResult[]) {
  const SEP = "═".repeat(80);
  const sep = "─".repeat(80);

  console.log(`\n${SEP}`);
  console.log("  PYREEZ FIELD TEST — ClaudeCliProvider 실사용 결과");
  console.log(SEP);

  // --- Per-scenario detail ---
  for (const r of results) {
    const { trace } = r;
    console.log(`\n${sep}`);
    console.log(`▸ ${r.scenario}`);
    console.log(sep);

    // Slot 2: Classification
    console.log(
      `  [Classify]  domain=${trace.classified.domain}  taskType=${trace.classified.taskType}  ` +
        `complexity=${trace.classified.complexity}  method=${trace.classified.method}`,
    );

    // Slot 3: Profile (top 3 capabilities)
    const caps = Object.entries(trace.requirement.capabilities)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => `${k}=${v.toFixed(2)}`)
      .join("  ");
    console.log(`  [Profile]   ${caps}`);

    // Slot 4: Selection
    const models = trace.plan.models
      .map((m) => `${m.modelId}(${m.role ?? "?"})`)
      .join(", ");
    console.log(
      `  [Select]    strategy=${trace.plan.strategy}  models=[${models}]`,
    );
    console.log(
      `  [Select]    estimatedCost=$${trace.plan.estimatedCost.toFixed(4)}`,
    );

    // Slot 5: Deliberation
    console.log(
      `  [Deliberate] protocol=${trace.result.protocol}  rounds=${trace.result.roundsExecuted}  ` +
        `consensus=${trace.result.consensusReached}  llmCalls=${trace.result.totalLLMCalls}`,
    );

    // Quality & Latency
    const qc = r.qualityCheck.passed ? "✓ PASS" : `✗ FAIL (missing: ${r.qualityCheck.missing.join(", ")})`;
    console.log(`  [Quality]   ${qc}`);
    console.log(`  [Latency]   ${(r.latencyMs / 1000).toFixed(1)}s`);

    // Response preview
    const preview = trace.result.result.slice(0, 300).replace(/\n/g, "\n              ");
    console.log(`  [Response]  ${preview}${trace.result.result.length > 300 ? "..." : ""}`);
  }

  // --- Summary ---
  console.log(`\n${SEP}`);
  console.log("  SUMMARY");
  console.log(SEP);

  const passCount = results.filter((r) => r.qualityCheck.passed).length;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
  const totalLLMCalls = results.reduce((s, r) => s + r.trace.result.totalLLMCalls, 0);
  const allModels = new Set(results.flatMap((r) => r.trace.result.modelsUsed));

  console.log(`\n  Scenarios:    ${passCount}/${results.length} passed`);
  console.log(`  Total time:   ${(totalLatency / 1000).toFixed(1)}s`);
  console.log(`  Avg latency:  ${(totalLatency / results.length / 1000).toFixed(1)}s per scenario`);
  console.log(`  LLM calls:    ${totalLLMCalls} total`);
  console.log(`  Models used:  ${[...allModels].join(", ")}`);
  console.log(`  Provider:     ClaudeCliProvider (claude -p, $0 extra cost)`);

  // Per-scenario table
  console.log(
    `\n  ${"Scenario".padEnd(30)} ${"Latency".padEnd(10)} ${"LLM Calls".padEnd(12)} ${"Protocol".padEnd(18)} Status`,
  );
  console.log(`  ${"-".repeat(85)}`);
  for (const r of results) {
    console.log(
      `  ${r.scenario.padEnd(30)} ${(r.latencyMs / 1000).toFixed(1).padStart(5)}s${" ".repeat(4)} ` +
        `${String(r.trace.result.totalLLMCalls).padEnd(12)} ` +
        `${r.trace.result.protocol.padEnd(18)} ` +
        `${r.qualityCheck.passed ? "✓" : "✗"}`,
    );
  }

  console.log(`\n${SEP}\n`);
}

// --- Main ---

const engine = createEngine(ENGINE_CONFIG, chatFn);

async function main() {
  console.log("=== Pyreez Field Test ===");
  console.log(`Config: ${JSON.stringify({ ...ENGINE_CONFIG, modelIds: CLAUDE_MODELS.length + " models" })}`);
  console.log(`Budget: $${BUDGET.perRequest}/request`);
  console.log(`Scenarios: ${SCENARIOS.length}\n`);

  const results: FieldResult[] = [];

  for (const s of SCENARIOS) {
    process.stdout.write(`Running: ${s.name}...`);
    try {
      const result = await runScenario(s);
      results.push(result);
      console.log(` done (${(result.latencyMs / 1000).toFixed(1)}s)`);
    } catch (err) {
      console.log(` ERROR: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (results.length > 0) {
    printReport(results);
  }
}

main().catch((err) => {
  console.error("Field test failed:", err);
  process.exit(1);
});
