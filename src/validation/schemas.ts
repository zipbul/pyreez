/**
 * Zod schemas for runtime validation at system boundaries.
 *
 * Used by CLI and file deserialization — anywhere external data
 * enters the system and TypeScript types provide no runtime safety.
 *
 * @module Validation Schemas
 */

import { z } from "zod/v4";

// -- Acceptance Workers (CLI --workers) --

export const AcceptanceWorkerSchema = z.object({
  model: z.string().min(1),
  original_position: z.string().min(1),
  alignment: z.enum(["on-task", "meta-critique"]).optional(),
});

export const AcceptanceWorkersArraySchema = z.array(AcceptanceWorkerSchema).min(1);

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
