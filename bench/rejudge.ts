#!/usr/bin/env bun
/**
 * Re-run inspect on existing deliberate outputs with a different judge.
 * Allows comparing judges without re-running expensive deliberate calls.
 *
 * Usage:
 *   bun run bench/rejudge.ts <existing-run-dir> <new-judge> [--out <new-dir>]
 */

import { spawn } from "bun";
import { mkdir } from "node:fs/promises";
import { BENCH_CASES } from "./cases";

async function runCli(args: string[], stdin: string): Promise<string> {
  const proc = spawn(["bun", "run", "src/cli.ts", ...args], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
  });
  proc.stdin!.write(stdin);
  await proc.stdin!.end();
  const text = await new Response(proc.stdout).text();
  await proc.exited;
  const idx = text.indexOf("\n{");
  return idx >= 0 ? text.slice(idx + 1) : text;
}

async function main() {
  const argv = process.argv.slice(2);
  const srcDir = argv[0];
  const judge = argv[1];
  let outDir = `bench/results/rejudge-${Date.now()}`;
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") { outDir = argv[i + 1]!; i++; }
  }
  if (!srcDir || !judge) {
    console.error("Usage: bun run bench/rejudge.ts <existing-run-dir> <new-judge> [--out <new-dir>]");
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });
  console.error(`[rejudge] judge=${judge} src=${srcDir} out=${outDir}`);

  const summary: any[] = [];
  for (const c of BENCH_CASES) {
    const delibPath = `${srcDir}/${c.id}.deliberate.json`;
    const f = Bun.file(delibPath);
    if (!(await f.exists())) {
      console.error(`  SKIP ${c.id} (no deliberate file)`);
      continue;
    }
    const delibJson = await f.text();
    console.error(`[rejudge] ${c.id}`);
    try {
      const inspJson = await runCli(
        ["inspect", "--task", c.task, "--judge", judge, "--deliberate", "-"],
        delibJson,
      );
      await Bun.write(`${outDir}/${c.id}.inspect.json`, inspJson);
      const insp = JSON.parse(inspJson);
      const cs = insp.convergenceScore ?? {};
      const c2 = cs.components ?? {};
      summary.push({
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
      });
    } catch (err) {
      summary.push({ id: c.id, category: c.category, expectedLevel: c.expectedLevel, error: String(err) });
    }
  }
  await Bun.write(`${outDir}/summary.json`, JSON.stringify(summary, null, 2));
  console.error(`[rejudge] summary written → ${outDir}/summary.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
