/**
 * Ratings feature enums.
 */

/** 채점 대상 프로토콜 — 피어 격리 + 런 내 동일 과제인 3종만 (v5 §0). */
export enum ScoredProtocol {
  SharedConvergence = "shared_convergence",
  AdversarialDebate = "adversarial_debate",
  EvaluationScoring = "evaluation_scoring",
}
