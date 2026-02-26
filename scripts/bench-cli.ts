/**
 * Claude CLI (-p) benchmark script.
 * Tests response quality, latency, and model routing across
 * representative pyreez deliberation prompts.
 *
 * Usage: bun run scripts/bench-cli.ts
 */

const CLAUDE_BIN = "/home/revil/.local/bin/claude";

// --- Test Cases ---

interface BenchCase {
  name: string;
  model: string;
  systemPrompt?: string;
  userPrompt: string;
  /** Substring(s) expected in a good response. */
  expectContains?: string[];
  /** Minimum response length (chars) to be considered valid. */
  minLength?: number;
}

const CASES: BenchCase[] = [
  // 1. Simple reasoning (Haiku — fast, cheap)
  {
    name: "reasoning-haiku",
    model: "claude-haiku-4-5",
    userPrompt: "What is 17 * 23? Answer with just the number.",
    expectContains: ["391"],
    minLength: 1,
  },
  // 2. Code generation (Sonnet — balanced)
  {
    name: "codegen-sonnet",
    model: "claude-sonnet-4-6",
    systemPrompt: "You are a TypeScript expert. Reply with code only, no markdown fences.",
    userPrompt:
      "Write a function `isPrime(n: number): boolean` that checks if a number is prime.",
    expectContains: ["isPrime", "boolean"],
    minLength: 50,
  },
  // 3. Deliberation-style analysis (Sonnet — role-based)
  {
    name: "deliberation-sonnet",
    model: "claude-sonnet-4-6",
    systemPrompt:
      "You are a senior code reviewer. Provide concise, actionable feedback.",
    userPrompt: `Review this function:
function add(a, b) { return a + b; }
Identify issues and suggest improvements in 3 bullet points.`,
    expectContains: ["type", "TypeScript"],
    minLength: 50,
  },
  // 4. Korean language support (Sonnet)
  {
    name: "korean-sonnet",
    model: "claude-sonnet-4-6",
    userPrompt: "다음 코드의 문제점을 한국어로 설명해줘: const x = null; x.toString();",
    expectContains: ["null"],
    minLength: 30,
  },
  // 5. JSON structured output (Sonnet)
  {
    name: "structured-sonnet",
    model: "claude-sonnet-4-6",
    systemPrompt: "Respond with valid JSON only. No markdown, no explanation.",
    userPrompt:
      'Return a JSON object with fields: "language" (string), "year" (number), "typed" (boolean) for TypeScript.',
    expectContains: ["TypeScript", "language"],
    minLength: 20,
  },
];

// --- Runner ---

interface BenchResult {
  name: string;
  model: string;
  latencyMs: number;
  outputLength: number;
  passed: boolean;
  failures: string[];
  output: string;
}

async function runCase(c: BenchCase): Promise<BenchResult> {
  const args = ["-p", "--model", c.model, "--output-format", "json", "--max-turns", "1"];
  if (c.systemPrompt) {
    args.push("--system-prompt", c.systemPrompt);
  }

  const start = performance.now();

  // Strip CLAUDECODE env var to allow spawning from within a Claude Code session
  const env = { ...process.env };
  delete env.CLAUDECODE;

  const proc = Bun.spawn([CLAUDE_BIN, ...args], {
    stdin: new Blob([c.userPrompt]),
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  const latencyMs = Math.round(performance.now() - start);
  const failures: string[] = [];

  if (exitCode !== 0) {
    return {
      name: c.name,
      model: c.model,
      latencyMs,
      outputLength: 0,
      passed: false,
      failures: [`Exit code ${exitCode}: ${stderr.trim()}`],
      output: stderr.trim(),
    };
  }

  // Parse JSON output
  let responseText = stdout;
  try {
    const parsed = JSON.parse(stdout) as { result?: string; is_error?: boolean };
    if (parsed.is_error) {
      return {
        name: c.name,
        model: c.model,
        latencyMs,
        outputLength: 0,
        passed: false,
        failures: [`CLI error: ${parsed.result}`],
        output: parsed.result ?? "",
      };
    }
    responseText = parsed.result ?? "";
  } catch {
    // Use raw output if not JSON
  }

  // Validate
  if (c.minLength && responseText.length < c.minLength) {
    failures.push(`Too short: ${responseText.length} < ${c.minLength}`);
  }
  if (c.expectContains) {
    for (const expected of c.expectContains) {
      if (!responseText.toLowerCase().includes(expected.toLowerCase())) {
        failures.push(`Missing: "${expected}"`);
      }
    }
  }

  return {
    name: c.name,
    model: c.model,
    latencyMs,
    outputLength: responseText.length,
    passed: failures.length === 0,
    failures,
    output: responseText.slice(0, 200),
  };
}

// --- Main ---

async function main() {
  console.log("=== Claude CLI (-p) Benchmark ===\n");
  console.log(`Binary: ${CLAUDE_BIN}`);
  console.log(`Cases:  ${CASES.length}\n`);

  const results: BenchResult[] = [];

  for (const c of CASES) {
    process.stdout.write(`  Running ${c.name} (${c.model})...`);
    const result = await runCase(c);
    results.push(result);
    const status = result.passed ? "PASS" : "FAIL";
    console.log(` ${status} (${result.latencyMs}ms)`);
  }

  // Summary
  console.log("\n=== Results ===\n");

  const passCount = results.filter((r) => r.passed).length;
  const totalLatency = results.reduce((s, r) => s + r.latencyMs, 0);
  const avgLatency = Math.round(totalLatency / results.length);

  console.log(`Pass: ${passCount}/${results.length}`);
  console.log(`Total time: ${(totalLatency / 1000).toFixed(1)}s`);
  console.log(`Avg latency: ${avgLatency}ms\n`);

  // Detail table
  console.log(
    "Name".padEnd(25) +
      "Model".padEnd(20) +
      "Latency".padEnd(10) +
      "Len".padEnd(8) +
      "Status".padEnd(8) +
      "Notes",
  );
  console.log("-".repeat(90));

  for (const r of results) {
    console.log(
      r.name.padEnd(25) +
        r.model.padEnd(20) +
        `${r.latencyMs}ms`.padEnd(10) +
        `${r.outputLength}`.padEnd(8) +
        (r.passed ? "PASS" : "FAIL").padEnd(8) +
        (r.failures.length > 0 ? r.failures.join("; ") : ""),
    );
  }

  // Output previews
  console.log("\n=== Response Previews ===\n");
  for (const r of results) {
    console.log(`--- ${r.name} ---`);
    console.log(r.output);
    console.log();
  }

  // Exit with failure code if any case failed
  if (passCount < results.length) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
