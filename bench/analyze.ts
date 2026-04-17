#!/usr/bin/env bun
/**
 * Analyze a benchmark run: distribution, judge accuracy, threshold suggestions.
 *
 * Usage: bun run bench/analyze.ts <bench/results/run-N>
 */

interface SummaryRow {
  id: string;
  category: string;
  expectedLevel: "high" | "moderate" | "diverse";
  observedLevel?: "high" | "moderate" | "diverse" | "unknown" | "insufficient" | null;
  overall?: number | null;
  status?: "converged" | "refining" | "diverging" | null;
  semantic?: number | null;
  diversity?: number | null;
  evidence?: number | null;
  stability?: number | null;
  error?: string;
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx]!;
}

async function main() {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: bun run bench/analyze.ts <bench/results/run-N>");
    process.exit(1);
  }
  const summary: SummaryRow[] = await Bun.file(`${dir}/summary.json`).json();
  const ok = summary.filter((r) => !r.error);
  const failed = summary.filter((r) => r.error);

  console.log(`# Bench Analysis: ${dir}\n`);
  console.log(`Cases: ${summary.length} total, ${ok.length} ok, ${failed.length} failed\n`);

  // 1. Judge accuracy vs expected
  const judgeMatch = ok.filter((r) => r.observedLevel === r.expectedLevel).length;
  console.log(`## Judge accuracy vs expected\n`);
  console.log(`- ${judgeMatch}/${ok.length} = ${pct(judgeMatch / Math.max(ok.length, 1))}\n`);
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of ok) {
    const e = r.expectedLevel;
    const o = r.observedLevel ?? "null";
    confusion[e] ??= {};
    confusion[e][o] = (confusion[e][o] ?? 0) + 1;
  }
  console.log(`Confusion (rows=expected, cols=observed):`);
  console.log(JSON.stringify(confusion, null, 2));

  // 2. Score distribution by judge level
  console.log(`\n## Score distribution by observed judge level\n`);
  for (const lvl of ["high", "moderate", "diverse"] as const) {
    const scores = ok
      .filter((r) => r.observedLevel === lvl && typeof r.overall === "number")
      .map((r) => r.overall!)
      .sort((a, b) => a - b);
    if (scores.length === 0) {
      console.log(`- ${lvl}: 0 cases`);
      continue;
    }
    console.log(`- ${lvl}: n=${scores.length} min=${scores[0]!.toFixed(3)} p25=${quantile(scores, 0.25).toFixed(3)} median=${quantile(scores, 0.5).toFixed(3)} p75=${quantile(scores, 0.75).toFixed(3)} max=${scores[scores.length - 1]!.toFixed(3)}`);
  }

  // 3. Threshold suggestion
  console.log(`\n## Threshold suggestion\n`);
  const high = ok.filter((r) => r.observedLevel === "high" && typeof r.overall === "number").map((r) => r.overall!);
  const mod = ok.filter((r) => r.observedLevel === "moderate" && typeof r.overall === "number").map((r) => r.overall!);
  const div = ok.filter((r) => r.observedLevel === "diverse" && typeof r.overall === "number").map((r) => r.overall!);
  if (high.length && mod.length) {
    const highMin = Math.min(...high);
    const modMax = Math.max(...mod);
    if (highMin > modMax) {
      const mid = (highMin + modMax) / 2;
      console.log(`- converged threshold: highMin=${highMin.toFixed(3)} > modMax=${modMax.toFixed(3)} → suggest ${mid.toFixed(2)}`);
    } else {
      console.log(`- converged threshold: classes overlap (highMin=${highMin.toFixed(3)} ≤ modMax=${modMax.toFixed(3)}) — score insufficient to separate`);
    }
  }
  if (mod.length && div.length) {
    const modMin = Math.min(...mod);
    const divMax = Math.max(...div);
    if (modMin > divMax) {
      const mid = (modMin + divMax) / 2;
      console.log(`- diverging threshold: modMin=${modMin.toFixed(3)} > divMax=${divMax.toFixed(3)} → suggest ${mid.toFixed(2)}`);
    } else {
      console.log(`- diverging threshold: classes overlap — score insufficient to separate`);
    }
  } else if (div.length === 0) {
    console.log(`- diverging threshold: no DIVERSE cases observed; cannot calibrate from this run`);
  }

  // 4. Component analysis
  console.log(`\n## Component contribution\n`);
  for (const comp of ["semantic", "diversity", "evidence", "stability"] as const) {
    const vals = ok.map((r) => r[comp]).filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
    if (vals.length === 0) continue;
    const zero = vals.filter((v) => v === 0).length;
    console.log(`- ${comp}: n=${vals.length} zero=${zero}/${vals.length} mean=${(vals.reduce((s, v) => s + v, 0) / vals.length).toFixed(3)} median=${quantile(vals, 0.5).toFixed(3)}`);
  }

  if (failed.length > 0) {
    console.log(`\n## Failures\n`);
    for (const f of failed) console.log(`- ${f.id}: ${f.error?.slice(0, 200)}`);
  }
}

main().catch((e) => {
  console.error("bench/analyze.ts failed:", e);
  process.exit(1);
});
