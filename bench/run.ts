#!/usr/bin/env bun
/**
 * Run all benchmark cases through deliberate + inspect, save results.
 *
 * Usage:
 *   bun run bench/run.ts --models "m1,m2,m3" --judge <model> [--out bench/results/run-N]
 *
 * Each case writes:
 *   <out>/<case-id>.deliberate.json
 *   <out>/<case-id>.inspect.json
 *
 * Then bench/analyze.ts can produce a distribution summary.
 */

import { spawn } from "bun";
import { mkdir } from "node:fs/promises";
import { BENCH_CASES } from "./cases";

interface Args {
  models: string;
  judge: string;
  out: string;
  cases?: string[];
}

function parseArgs(): Args {
  const a: Partial<Args> = { out: `bench/results/run-${Date.now()}` };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--models") { a.models = v; i++; }
    else if (k === "--judge") { a.judge = v; i++; }
    else if (k === "--out") { a.out = v; i++; }
    else if (k === "--cases") { a.cases = v!.split(","); i++; }
  }
  if (!a.models) throw new Error("--models required");
  if (!a.judge) throw new Error("--judge required");
  return a as Args;
}

async function runCli(args: string[], stdin?: string): Promise<string> {
  const proc = spawn(["bun", "run", "src/cli.ts", ...args], {
    stdin: stdin ? "pipe" : undefined,
    stdout: "pipe",
    stderr: "ignore",
  });
  if (stdin) {
    proc.stdin!.write(stdin);
    await proc.stdin!.end();
  }
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  // Skip pyreez log lines before JSON
  const idx = text.indexOf("\n{");
  return idx >= 0 ? text.slice(idx + 1) : text;
}

async function main() {
  const args = parseArgs();
  const cases = args.cases
    ? BENCH_CASES.filter((c) => args.cases!.includes(c.id))
    : BENCH_CASES;

  await mkdir(args.out, { recursive: true });
  console.error(`[bench] running ${cases.length} cases → ${args.out}`);

  const summary: any[] = [];
  for (const c of cases) {
    console.error(`\n[bench] === ${c.id} (${c.category}) ===`);
    try {
      const delibJson = await runCli([
        "deliberate",
        "--protocol", "shared_convergence",
        "--models", args.models,
        "--max-rounds", "1",
        "--task", c.task,
      ]);
      await Bun.write(`${args.out}/${c.id}.deliberate.json`, delibJson);

      const inspJson = await runCli(
        ["inspect", "--task", c.task, "--judge", args.judge, "--deliberate", "-"],
        delibJson,
      );
      await Bun.write(`${args.out}/${c.id}.inspect.json`, inspJson);

      const insp = JSON.parse(inspJson);
      const cs = insp.convergenceScore ?? {};
      const c2 = cs.components ?? {};
      const row = {
        id: c.id,
        category: c.category,
        expectedLevel: c.expectedLevel,
        observedLevel: insp.convergence?.level ?? null,
        overall: cs.overall ?? null,
        status: cs.status ?? null,
        semantic: c2.semantic ?? null,
        diversity: c2.diversity ?? null,
        evidence: c2.evidence ?? null,
        stability: c2.stability ?? null,
      };
      summary.push(row);
      console.error(`  level=${row.observedLevel} score=${row.overall} status=${row.status}`);
    } catch (err) {
      console.error(`  FAIL: ${err instanceof Error ? err.message : String(err)}`);
      summary.push({ id: c.id, category: c.category, expectedLevel: c.expectedLevel, error: String(err) });
    }
  }

  await Bun.write(`${args.out}/summary.json`, JSON.stringify(summary, null, 2));
  console.error(`\n[bench] summary written to ${args.out}/summary.json`);
}

main().catch((e) => {
  console.error("bench/run.ts failed:", e);
  process.exit(1);
});
