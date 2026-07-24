/**
 * Axis types — shared across deliberation infrastructure.
 */


/**
 * Result of a single LLM call.
 */
export interface ChatResult {
  readonly content: string;
  /** Provider session id for this call (when exposed), recorded so the session can be resumed. */
  readonly sessionId?: string;
}

