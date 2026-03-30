/**
 * Zod schemas for runtime validation at system boundaries.
 *
 * Used by CLI and file deserialization — anywhere external data
 * enters the system and TypeScript types provide no runtime safety.
 *
 * @module Validation Schemas
 */

import { z } from "zod/v4";

// -- Feedback Evaluation (CLI --evaluations) --

export const BinaryDimensionsSchema = z.object({
  factually_correct: z.boolean(),
  addresses_task: z.boolean(),
  provides_evidence: z.boolean(),
  novel_perspective: z.boolean(),
  internally_consistent: z.boolean(),
});

export const FailureFlagsSchema = z.object({
  hallucination: z.boolean(),
  refusal: z.boolean(),
  off_topic: z.boolean(),
  degenerate: z.boolean(),
});

export const EvaluationInputSchema = z.object({
  model_id: z.string().min(1),
  domain: z.string().min(1),
  task_type: z.string().min(1),
  dimensions: BinaryDimensionsSchema,
  failures: FailureFlagsSchema,
});

export const EvaluationsArraySchema = z.array(EvaluationInputSchema).min(1);

// -- Acceptance Workers (CLI --workers) --

export const AcceptanceWorkerSchema = z.object({
  model: z.string().min(1),
  original_position: z.string().min(1),
});

export const AcceptanceWorkersArraySchema = z.array(AcceptanceWorkerSchema).min(1);

// -- Anonymization State (session.json) --

export const AnonymizationStateSchema = z.object({
  anonToReal: z.record(z.string(), z.string()),
  realToAnon: z.record(z.string(), z.string()),
  providerRealToAnon: z.record(z.string(), z.string()),
  nextAnonIndex: z.number().int().min(0),
  nextProviderIndex: z.number().int().min(0),
});

// -- Cooldown State (cooldown.json) --

const CooldownErrorTypeSchema = z.enum([
  "rate_limit", "server_error", "timeout", "auth_error", "degenerate", "unknown",
]);

export const CooldownStateSchema = z.object({
  entries: z.array(z.object({
    modelId: z.string().min(1),
    reason: z.string(),
    errorType: CooldownErrorTypeSchema,
    failCount: z.number().int().min(0),
  })),
  providers: z.array(z.string()),
  savedAt: z.number(),
});

// -- SkillCell Store (skillcells.json) --

const BetaParamsSchema = z.object({
  alpha: z.number().min(0),
  beta: z.number().min(0),
});

const SkillCellSchema = z.object({
  model_id: z.string(),
  domain: z.string(),
  task_type: z.string(),
  dimensions: z.record(z.string(), BetaParamsSchema),
  failure_counts: z.record(z.string(), z.number()),
  total: z.number().int().min(0),
});

export const SkillCellStoreFileSchema = z.object({
  version: z.literal(1),
  cells: z.record(z.string(), SkillCellSchema),
});

// -- Utility --

/**
 * Parse and validate external JSON with a zod schema.
 * Returns { success: true, data } or { success: false, error: string }.
 */
export function parseWithSchema<T>(
  raw: string,
  schema: z.ZodType<T>,
  label: string,
): { success: true; data: T } | { success: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { success: false, error: `${label}: invalid JSON` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = z.prettifyError(result.error);
    return { success: false, error: `${label}: validation failed\n${issues}` };
  }
  return { success: true, data: result.data };
}
