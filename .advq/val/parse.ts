// Paired-validation metrics parser for the two new evidence-block guards.
// Reads a deliberation JSON, returns per-worker-content metrics.
import { readFileSync } from "fs";

function metricsFor(content: string) {
  // findings: each block starting at a confidence line
  // Confidence labels are UPPERCASE HIGH/MEDIUM/LOW; severity tiers are lowercase. Match uppercase only
  // (covers both "confidence: HIGH" and the merged "verdict: critical — HIGH confidence" formats).
  const confs = [...content.matchAll(/\b(HIGH|MEDIUM|LOW)\b/g)].map(m => m[1]!);
  const high = confs.filter(c => c === "HIGH").length;
  const med = confs.filter(c => c === "MEDIUM").length;
  const low = confs.filter(c => c === "LOW").length;
  const findings = confs.length;
  // G2 signals: hedging density
  const unverified = (content.match(/\[unverified\]/gi) || []).length;
  // specific external-looking quantities: numbers with units / precision (exclude the task's own "24-hour", "100ms" is task; we count all and report raw)
  const numericTokens = (content.match(/\b\d[\d,.]*\s?(ms|s\b|seconds|minutes|hours|MB|GB|KB|%|x\b|requests|ops|QPS|RPS)\b/gi) || []).length;
  // approximate order-of-magnitude / directional hedges
  const ranges = (content.match(/order[- ]of[- ]magnitude|~\s?\d|roughly|approximately|on the order of|\bup to\b|\b\d+\s?[-–]\s?\d+\b/gi) || []).length;
  return { findings, high, med, low, highFrac: findings ? +(high / findings).toFixed(3) : 0, unverified, numericTokens, ranges, len: content.length };
}

const files = process.argv.slice(2);
const agg: any = { findings: 0, high: 0, med: 0, low: 0, unverified: 0, numericTokens: 0, ranges: 0, workers: 0 };
for (const f of files) {
  let j: any;
  try { j = JSON.parse(readFileSync(f, "utf8")); } catch { console.log(`SKIP ${f} (no json)`); continue; }
  for (const r of j.rounds || []) {
    for (const w of r.responses || []) {
      const m = metricsFor(w.content || "");
      agg.findings += m.findings; agg.high += m.high; agg.med += m.med; agg.low += m.low;
      agg.unverified += m.unverified; agg.numericTokens += m.numericTokens; agg.ranges += m.ranges; agg.workers++;
      console.log(`${f.split("/").pop()} R${r.number} ${w.model.split("/").pop()}  find=${m.findings} HIGH=${m.high} MED=${m.med} LOW=${m.low} hf=${m.highFrac} unv=${m.unverified} num=${m.numericTokens} rng=${m.ranges}`);
    }
  }
}
agg.highFrac = agg.findings ? +(agg.high / agg.findings).toFixed(3) : 0;
console.log("AGG", JSON.stringify(agg));
