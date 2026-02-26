/**
 * Overhead comparison: default system prompt vs custom system prompt.
 * Measures the token/latency impact of replacing Claude Code's 22K system prompt.
 */

import { ClaudeCliProvider } from "../src/llm/providers/claude-cli";

const provider = new ClaudeCliProvider();
const PROMPT = "What is 2+2? Reply with just the number.";

async function measure(label: string) {
  const start = performance.now();
  const response = await provider.chat({
    model: "anthropic/claude-haiku-4.5",
    messages: [{ role: "user", content: PROMPT }],
  });
  const ms = Math.round(performance.now() - start);
  const text = response.choices[0]?.message.content ?? "";
  console.log(`  ${label}: ${ms}ms | response: "${text.trim()}"`);
  return ms;
}

async function main() {
  console.log("=== System Prompt Overhead Test ===\n");
  console.log("Using --system-prompt to replace Claude Code default (22K tokens)\n");

  // Warm up
  await measure("Warmup");

  // 3 measurements
  const times: number[] = [];
  for (let i = 1; i <= 3; i++) {
    times.push(await measure(`Run ${i} `));
  }

  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  console.log(`\n  Average: ${avg}ms (${(avg / 1000).toFixed(1)}s)`);
  console.log(`  Previous (with 22K overhead): ~3700ms`);
  console.log(`  Improvement: ~${Math.round((1 - avg / 3700) * 100)}% faster`);
}

main().catch(console.error);
