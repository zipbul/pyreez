/**
 * Cross-validation of factual claims across multiple responses.
 *
 * Pattern adapted from FActScore (Min et al., EMNLP 2023, arXiv 2305.14251):
 * decompose a generation into atomic facts and validate each against a
 * knowledge source. We don't have an external knowledge source here, so
 * the *other* worker responses act as the source — claims unsupported or
 * contradicted by peers are flagged for the host.
 *
 * Useful for spotting hallucinations, off-task tangents, and claims that
 * survived only because no other worker happened to address them.
 *
 * @module quality/cross-validate
 */

export interface ResponseUnderReview {
  readonly id: string;
  readonly content: string;
}

export interface JudgeResult {
  readonly unsupportedClaims: readonly string[];
  readonly contradictedClaims: readonly string[];
}

export interface ResponseFinding {
  readonly id: string;
  readonly unsupported: readonly string[];
  readonly contradicted: readonly string[];
}

export interface CrossValidateResult {
  readonly findings: readonly ResponseFinding[];
}

/**
 * Judge function: receives the response under review and the other responses,
 * returns lists of subject claims that are unsupported (no peer mentions them)
 * and contradicted (a peer asserts the opposite).
 */
export type CrossValidateFn = (
  subject: ResponseUnderReview,
  others: readonly ResponseUnderReview[],
) => Promise<JudgeResult>;

/**
 * Run cross-validation: for each response, ask the judge to identify factual
 * claims that other responses do not support or that they contradict.
 * Cost: N judge calls for N responses (single response = 0 calls).
 */
export async function crossValidate(
  responses: readonly ResponseUnderReview[],
  judge: CrossValidateFn,
): Promise<CrossValidateResult> {
  if (responses.length < 2) {
    return {
      findings: responses.map((r) => ({ id: r.id, unsupported: [], contradicted: [] })),
    };
  }

  const findings: ResponseFinding[] = [];
  for (const subject of responses) {
    const others = responses.filter((r) => r.id !== subject.id);
    const result = await judge(subject, others);
    findings.push({
      id: subject.id,
      unsupported: result.unsupportedClaims,
      contradicted: result.contradictedClaims,
    });
  }

  return { findings };
}
