/**
 * CLI output-boundary anonymization (P5, v5 §1.5). The documented host interface (deliberate,
 * interrogate) must never leak real model/provider identity — only the internal pipeline (debug
 * capture, scoring, ratings) keeps real names. DeliberateOutput itself is never mutated; this module
 * only transforms the object about to be printed, in cli.ts, right before JSON.stringify.
 *
 * Label rule: a model that was part of the originally-requested team gets `worker-{i}` (i = its
 * position in that team array — the same position engine.ts assigns as workerIndex). Any other
 * model (a fallback swapped in from outside the team) gets `fallback-{n}` in first-seen order.
 * Once assigned, a model's label never changes within a run.
 */

import type { DeliberateOutput } from "./deliberation/types";

/** A model → label lookup, consulted before assigning anything new. */
type LabelOf = (model: string) => string;

/**
 * Pure decision: what label should `model` get, given its team + the labels already handed out?
 * Does not mutate `assigned` — callers (ModelLabeler) own sequencing.
 */
export function nextLabel(team: readonly string[], assigned: ReadonlyMap<string, string>, model: string): string {
  const existing = assigned.get(model);
  if (existing) return existing;
  const teamIndex = team.indexOf(model);
  if (teamIndex !== -1) return `worker-${teamIndex}`;
  const fallbackCount = [...assigned.values()].filter((label) => label.startsWith("fallback-")).length;
  return `fallback-${fallbackCount}`;
}

/**
 * Stateful label sequencer for one CLI invocation — the same instance must be reused across the
 * streaming onRound callback and the final result transform so a model's label is consistent
 * ("런 내 일관") whether it first appears mid-stream or only in the final payload.
 */
export class ModelLabeler {
  private readonly assigned = new Map<string, string>();

  constructor(private readonly team: readonly string[]) {}

  labelOf(model: string): string {
    const label = nextLabel(this.team, this.assigned, model);
    this.assigned.set(model, label);
    return label;
  }
}

/**
 * Fields anonymizeModelFields knows how to relabel. Every one is optional — callers pass either the
 * full DeliberateOutput success shape or one of handlers.ts's narrower error-JSON shapes (which
 * share these same field names, just not all of them at once, and TeamDegradedError's error JSON
 * flattens `lostSlots` to the top level instead of nesting it under `degradation`). The index
 * signature keeps `T extends AnonymizableFields` from rejecting sibling fields (e.g. NoModelsAvailableError's
 * `code`/`remediation`) that carry no model identity and must simply pass through untouched.
 */
interface AnonymizableFields {
  readonly modelsUsed?: DeliberateOutput["modelsUsed"];
  readonly rounds?: DeliberateOutput["rounds"];
  readonly modelSwaps?: DeliberateOutput["modelSwaps"];
  readonly degradation?: DeliberateOutput["degradation"];
  /** TeamDegradedError's flattened error-JSON payload puts lostSlots at the top level. */
  readonly lostSlots?: readonly { readonly model: string; readonly reason: string }[];
  readonly [key: string]: unknown;
}

/**
 * Deep, explicit-field transform — replaces every known model-identity field via `labelOf`. No
 * blind string substitution: only the fields named below are touched, everything else passes
 * through unchanged. Works on both the full DeliberateOutput success shape and the narrower
 * error-JSON shapes handlers.ts builds for NoModelsAvailableError / RoundExecutionError /
 * TeamDegradedError (they share these same field names, just not all of them at once).
 */
export function anonymizeModelFields<T extends AnonymizableFields>(data: T, labelOf: LabelOf): T {
  return {
    ...data,
    ...(data.modelsUsed ? { modelsUsed: data.modelsUsed.map(labelOf) } : {}),
    ...(data.rounds
      ? {
          rounds: data.rounds.map((round) => ({
            ...round,
            ...(round.responses
              ? { responses: round.responses.map((resp) => ({ ...resp, model: labelOf(resp.model) })) }
              : {}),
            ...(round.failedWorkers
              ? { failedWorkers: round.failedWorkers.map((fw) => ({ ...fw, model: labelOf(fw.model) })) }
              : {}),
          })),
        }
      : {}),
    ...(data.modelSwaps
      ? {
          modelSwaps: data.modelSwaps.map((swap) => ({
            ...swap,
            original: labelOf(swap.original),
            ...(swap.replacement !== undefined ? { replacement: labelOf(swap.replacement) } : {}),
          })),
        }
      : {}),
    ...(data.degradation
      ? {
          degradation: {
            ...data.degradation,
            lostSlots: data.degradation.lostSlots.map((slot) => ({ ...slot, model: labelOf(slot.model) })),
          },
        }
      : {}),
    ...(data.lostSlots ? { lostSlots: data.lostSlots.map((slot) => ({ ...slot, model: labelOf(slot.model) })) } : {}),
  };
}
