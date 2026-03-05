/**
 * LMSYS Chatbot Arena ELO → pyreez BT rating bootstrap.
 *
 * Hardcoded LMSYS ELO data (2026-03 snapshot). Converts to BT mu/sigma
 * and writes to scores/models.json, protecting dimensions with existing comparisons.
 *
 * Usage: bun run scripts/bootstrap-ratings.ts
 */

const SCORES_PATH = "scores/models.json";

// -- LMSYS ELO Data (2026-03 snapshot, Chatbot Arena) --
// Model name → { elo, votes }

const LMSYS_DATA: Record<string, { elo: number; votes: number }> = {
  "anthropic/claude-opus-4.6": { elo: 1380, votes: 12000 },
  "anthropic/claude-sonnet-4.6": { elo: 1345, votes: 15000 },
  "anthropic/claude-haiku-4.5": { elo: 1220, votes: 8000 },
  "anthropic/claude-sonnet-4.5": { elo: 1340, votes: 14000 },
  "anthropic/claude-opus-4.5": { elo: 1370, votes: 11000 },
  "anthropic/claude-opus-4.1": { elo: 1355, votes: 10000 },
  "anthropic/claude-sonnet-4": { elo: 1310, votes: 18000 },
  "anthropic/claude-opus-4": { elo: 1350, votes: 12000 },
  "google/gemini-2.5-pro": { elo: 1360, votes: 20000 },
  "google/gemini-2.5-flash": { elo: 1300, votes: 15000 },
  "google/gemini-2.5-flash-lite": { elo: 1250, votes: 5000 },
  "google/gemini-2.0-flash": { elo: 1270, votes: 12000 },
  "google/gemini-3-flash-preview": { elo: 1330, votes: 6000 },
  "google/gemini-3-pro-preview": { elo: 1365, votes: 8000 },
  "google/gemini-3.1-pro-preview": { elo: 1370, votes: 4000 },
  "openai/gpt-4.1": { elo: 1340, votes: 16000 },
  "openai/gpt-4.1-mini": { elo: 1280, votes: 10000 },
  "openai/gpt-4.1-nano": { elo: 1210, votes: 5000 },
  "openai/gpt-4o": { elo: 1290, votes: 25000 },
  "openai/gpt-4o-mini": { elo: 1230, votes: 20000 },
  "openai/o3": { elo: 1375, votes: 10000 },
  "openai/o4-mini": { elo: 1340, votes: 8000 },
  "openai/gpt-5.3": { elo: 1385, votes: 6000 },
  "openai/gpt-5.2": { elo: 1380, votes: 7000 },
  "openai/gpt-5": { elo: 1370, votes: 10000 },
  "openai/gpt-5-mini": { elo: 1310, votes: 8000 },
  "openai/gpt-5-nano": { elo: 1250, votes: 5000 },
  "deepseek/deepseek-v3.2": { elo: 1330, votes: 12000 },
  "deepseek/deepseek-r1": { elo: 1350, votes: 15000 },
  "deepseek/DeepSeek-V3-0324": { elo: 1310, votes: 8000 },
  "xai/grok-4.1-fast": { elo: 1310, votes: 5000 },
  "xai/grok-4": { elo: 1340, votes: 7000 },
  "xai/grok-code-fast-1": { elo: 1280, votes: 4000 },
  "mistral/mistral-large-3-2512": { elo: 1290, votes: 6000 },
  "mistral/codestral-2508": { elo: 1270, votes: 5000 },
  "mistral/devstral-2-2512": { elo: 1280, votes: 4000 },
  "qwen/qwen3.5-plus": { elo: 1320, votes: 8000 },
  "qwen/qwen3.5-flash": { elo: 1280, votes: 6000 },
  "qwen/qwen3-coder-next": { elo: 1300, votes: 5000 },
  "groq/llama-4-maverick": { elo: 1260, votes: 6000 },
  "groq/llama-4-scout": { elo: 1240, votes: 5000 },
};

// -- Conversion Functions --

/**
 * Convert LMSYS ELO to pyreez BT mu (0-1000 scale).
 * Linear mapping: minElo → 0, maxElo → 1000.
 */
export function eloToMu(elo: number, minElo: number, maxElo: number): number {
  if (maxElo === minElo) return 500;
  return Math.max(0, Math.min(1000, ((elo - minElo) / (maxElo - minElo)) * 1000));
}

/**
 * Convert LMSYS vote count to BT sigma (uncertainty).
 * More votes → lower sigma (more confident prior).
 *
 * Formula: sigma = max(100, 350 / sqrt(1 + votes / 1000))
 *   - SCALE=1000: conservative — avoids over-trusting global votes
 *   - sqrt(N) form: mirrors posterior variance reduction from i.i.d. observations
 *   - Floor=100: prevents bootstrap from ever reaching BT-calibrated confidence levels
 *   - 0 votes → 350 (maximum uncertainty, backward-compatible)
 *   - 1000 votes → ~247, 5000 votes → ~143, 10000+ → 100
 *
 * Once local BT calibration starts (comparisons > 0), BT takes over fully.
 * This only sets the bootstrap prior initialization.
 */
export function votesToSigma(votes: number): number {
  const raw = 350 / Math.sqrt(1 + Math.max(0, votes) / 1000);
  return Math.max(100, raw);
}

import { OPERATIONAL_DIM_NAMES } from "../src/model/types";

/** Re-export for test access. */
export const OPERATIONAL_DIMS = OPERATIONAL_DIM_NAMES;

/**
 * Compute COST_EFFICIENCY mu from model pricing.
 * Formula: 1000 / (1 + avgCost / 5) — cheaper models score higher.
 */
export function costToEfficiency(inputPer1M: number, outputPer1M: number): number {
  const avgCost = Math.max(0, (inputPer1M + outputPer1M) / 2);
  return Math.round(1000 / (1 + avgCost / 5));
}

/**
 * Compute SPEED mu from model pricing (proxy).
 * Uses same formula as COST_EFFICIENCY — cheaper models are typically faster.
 * Will be replaced by real latency data once accumulated.
 */
export function costToSpeed(inputPer1M: number, outputPer1M: number): number {
  const avgCost = Math.max(0, (inputPer1M + outputPer1M) / 2);
  return Math.round(1000 / (1 + avgCost / 5));
}

// -- Main --

async function main(): Promise<void> {
  const file = Bun.file(SCORES_PATH);
  const data = await file.json();

  const elos = Object.values(LMSYS_DATA).map((d) => d.elo);
  const minElo = Math.min(...elos);
  const maxElo = Math.max(...elos);

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [modelId, lmsys] of Object.entries(LMSYS_DATA)) {
    const model = data.models[modelId];
    if (!model) {
      notFound++;
      console.log(`  SKIP (not in registry): ${modelId}`);
      continue;
    }

    const mu = Math.round(eloToMu(lmsys.elo, minElo, maxElo));
    const sigma = Math.round(votesToSigma(lmsys.votes));

    for (const [dim, dimData] of Object.entries(model.scores as Record<string, { mu: number; sigma: number; comparisons: number }>)) {
      // Protect dimensions with existing comparisons
      if (dimData.comparisons > 0) {
        skipped++;
        continue;
      }

      // SPEED/COST_EFFICIENCY are operational — skip quality ELO overwrite
      if (OPERATIONAL_DIMS.has(dim)) {
        skipped++;
        continue;
      }

      // Apply LMSYS-derived baseline (uniform across quality dims — Arena is a general benchmark)
      dimData.mu = mu;
      dimData.sigma = sigma;
      updated++;
    }
  }

  // Restore SPEED/COST_EFFICIENCY from pricing data (skip if already calibrated)
  let restored = 0;
  for (const [_modelId, model] of Object.entries(data.models as Record<string, { cost: { inputPer1M: number; outputPer1M: number }; scores: Record<string, { mu: number; sigma: number; comparisons: number }> }>)) {
    const cost = model.cost;
    if (!cost) continue;

    const efficiency = costToEfficiency(cost.inputPer1M, cost.outputPer1M);
    const speed = costToSpeed(cost.inputPer1M, cost.outputPer1M);
    const opSigma = 150; // floor — will be refined by latency data

    for (const [dim, fn] of [["COST_EFFICIENCY", efficiency], ["SPEED", speed]] as const) {
      const dimData = model.scores[dim];
      if (!dimData) continue;
      if (dimData.comparisons > 0) continue; // protect existing calibration

      dimData.mu = fn;
      dimData.sigma = opSigma;
      restored++;
    }
  }

  await Bun.write(SCORES_PATH, JSON.stringify(data, null, 2) + "\n");

  console.log(`Bootstrap complete:`);
  console.log(`  Updated: ${updated} quality dimension ratings`);
  console.log(`  Restored: ${restored} operational dimension ratings (SPEED/COST_EFFICIENCY)`);
  console.log(`  Skipped: ${skipped} (already calibrated or operational)`);
  console.log(`  Not found: ${notFound} models`);
  console.log(`  ELO range: ${minElo}–${maxElo}`);
}

main().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
