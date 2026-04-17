/**
 * GenFuser — LLM fuses ranked candidates into a single synthesis draft.
 *
 * Pattern from LLM-Blender (Jiang et al., ACL 2023): after PairRanker
 * surfaces the strongest candidates, GenFuser produces an output that
 * combines their strengths and mitigates their weaknesses.
 *
 * pyreez output is a synthesis DRAFT — the host should still apply
 * cross-worker gap checks and the stronger-case rule from SKILL.md.
 *
 * @module synthesis/fuser
 */

import type { ChatMessage } from "../llm/types";

export interface FuserCandidate {
  readonly id: string;
  readonly content: string;
}

export interface RankInfo {
  readonly id: string;
  readonly wins: number;
  readonly losses: number;
}

export interface FuseOptions {
  readonly ranking?: readonly RankInfo[];
}

export interface FuseResult {
  readonly fused: string;
}

export interface ChatFn {
  (model: string, messages: ChatMessage[]): Promise<{ content: string }>;
}

const SYSTEM = `You are fusing multiple candidate responses into a single best response to a task.

Adopt and extend — combine the strengths of strong candidates, mitigate their weaknesses, and produce a single coherent response.
Do NOT copy candidate text verbatim. Synthesize.
Do NOT present parallel options ("Option A / Option B"). Pick the strongest position and defend it.
When candidates contradict, weight evidence over assertion. When ranking weights are provided, treat them as a prior — but override the prior if a lower-ranked candidate has clearly stronger evidence on a specific point.

Output the fused response only. No preamble, no meta-commentary.`;

function buildMessages(
  task: string,
  candidates: readonly FuserCandidate[],
  ranking?: readonly RankInfo[],
): ChatMessage[] {
  const rankMap = new Map<string, RankInfo>();
  for (const r of ranking ?? []) rankMap.set(r.id, r);

  const blocks = candidates
    .map((c) => {
      const r = rankMap.get(c.id);
      const tag = r ? ` rank-info="wins=${r.wins} losses=${r.losses}"` : "";
      return `<candidate id="${c.id}"${tag}>\n${c.content}\n</candidate>`;
    })
    .join("\n\n");

  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>\n\n${blocks}\n\nProduce the fused response.`,
    },
  ];
}

/**
 * Fuse candidates into a single synthesis draft.
 * - 0 candidates: returns empty string
 * - 1 candidate: returns its content unchanged (no LLM call)
 * - 2+ candidates: 1 LLM call to fuse
 */
export async function fuseCandidates(
  model: string,
  chat: ChatFn,
  task: string,
  candidates: readonly FuserCandidate[],
  options?: FuseOptions,
): Promise<FuseResult> {
  if (candidates.length === 0) return { fused: "" };
  if (candidates.length === 1) return { fused: candidates[0]!.content };

  const r = await chat(model, buildMessages(task, candidates, options?.ranking));
  return { fused: r.content.trim() };
}
