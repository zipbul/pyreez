/**
 * Classification benchmark harness — measures classifyByRules accuracy.
 * Phase C4: Classification 사전 검증.
 */

import type {
  TaskDomain,
  TaskType,
  Complexity,
  Criticality,
  ClassifyResult,
} from "./types";

// -- Types --

export interface BenchmarkCase {
  /** Human prompt to classify. */
  prompt: string;
  /** Expected classification result. */
  expected: {
    domain: TaskDomain;
    taskType: TaskType;
    /** Optional — set only when complexity is predictable. */
    complexity?: Complexity;
    /** Optional — set only when criticality is predictable. */
    criticality?: Criticality;
  };
}

export type MismatchReason =
  | "unclassified"
  | "wrong-domain"
  | "wrong-task-type"
  | "wrong-complexity"
  | "wrong-criticality";

export interface BenchmarkMismatch {
  /** Original test case. */
  case: BenchmarkCase;
  /** What the classifier returned (null if unclassified). */
  actual: ClassifyResult | null;
  /** Which check failed first. */
  reason: MismatchReason;
}

export interface DomainStats {
  total: number;
  correct: number;
  accuracy: number;
}

export interface BenchmarkResult {
  total: number;
  correct: number;
  accuracy: number;
  misclassified: BenchmarkMismatch[];
  domainAccuracy: Record<string, DomainStats>;
}

export type ClassifyFn = (prompt: string) => ClassifyResult | null;

// -- Benchmark runner --

export function runBenchmark(
  cases: readonly BenchmarkCase[],
  classify: ClassifyFn,
): BenchmarkResult {
  const misclassified: BenchmarkMismatch[] = [];
  const domainCounts: Record<string, { total: number; correct: number }> = {};
  let correct = 0;

  for (const c of cases) {
    const { domain } = c.expected;

    if (!domainCounts[domain]) {
      domainCounts[domain] = { total: 0, correct: 0 };
    }
    domainCounts[domain].total++;

    const result = classify(c.prompt);

    if (result === null) {
      misclassified.push({ case: c, actual: null, reason: "unclassified" });
      continue;
    }

    if (result.domain !== c.expected.domain) {
      misclassified.push({ case: c, actual: result, reason: "wrong-domain" });
      continue;
    }

    if (result.taskType !== c.expected.taskType) {
      misclassified.push({
        case: c,
        actual: result,
        reason: "wrong-task-type",
      });
      continue;
    }

    if (
      c.expected.complexity !== undefined &&
      result.complexity !== c.expected.complexity
    ) {
      misclassified.push({
        case: c,
        actual: result,
        reason: "wrong-complexity",
      });
      continue;
    }

    if (
      c.expected.criticality !== undefined &&
      result.criticality !== c.expected.criticality
    ) {
      misclassified.push({
        case: c,
        actual: result,
        reason: "wrong-criticality",
      });
      continue;
    }

    correct++;
    domainCounts[domain].correct++;
  }

  const domainAccuracy: Record<string, DomainStats> = {};
  for (const [d, stats] of Object.entries(domainCounts)) {
    domainAccuracy[d] = {
      total: stats.total,
      correct: stats.correct,
      accuracy: stats.total > 0 ? stats.correct / stats.total : 0,
    };
  }

  const total = cases.length;
  return {
    total,
    correct,
    accuracy: total > 0 ? correct / total : 0,
    misclassified,
    domainAccuracy,
  };
}

// -- Seed dataset (25 cases, all 12 domains) --

export const SEED_CASES: readonly BenchmarkCase[] = [
  // TESTING (2)
  {
    prompt: "이 함수의 edge case를 찾아줘",
    expected: { domain: "TESTING", taskType: "EDGE_CASE_DISCOVERY" },
  },
  {
    prompt: "e2e 검증 진행해줘",
    expected: { domain: "TESTING", taskType: "INTEGRATION_TEST_WRITE" },
  },

  // DEBUGGING (2)
  {
    prompt: "에러 원인을 분석해줘",
    expected: { domain: "DEBUGGING", taskType: "ROOT_CAUSE" },
  },
  {
    prompt: "로그 분석해서 문제 찾아줘",
    expected: { domain: "DEBUGGING", taskType: "LOG_ANALYSIS" },
  },

  // REVIEW (2)
  {
    prompt: "보안 리뷰 진행해줘",
    expected: { domain: "REVIEW", taskType: "SECURITY_REVIEW" },
  },
  {
    prompt: "코드 검토 부탁해",
    expected: { domain: "REVIEW", taskType: "CODE_REVIEW" },
  },

  // ARCHITECTURE (2)
  {
    prompt: "모듈 설계 해줘",
    expected: { domain: "ARCHITECTURE", taskType: "MODULE_DESIGN" },
  },
  {
    prompt: "데이터 모델 만들어줘",
    expected: { domain: "ARCHITECTURE", taskType: "DATA_MODELING" },
  },

  // CODING (3)
  {
    prompt: "타입 정의 해줘",
    expected: { domain: "CODING", taskType: "TYPE_DEFINITION" },
  },
  {
    prompt: "에러 핸들링 추가해줘",
    expected: { domain: "CODING", taskType: "ERROR_HANDLING" },
  },
  {
    prompt: "알고리즘 구현해줘",
    expected: { domain: "CODING", taskType: "IMPLEMENT_ALGORITHM" },
  },

  // IDEATION (2)
  {
    prompt: "브레인스토밍 해보자",
    expected: { domain: "IDEATION", taskType: "BRAINSTORM" },
  },
  {
    prompt: "실현 가능성 분석해줘",
    expected: { domain: "IDEATION", taskType: "FEASIBILITY_QUICK" },
  },

  // OPERATIONS (2)
  {
    prompt: "CI/CD 파이프라인 설정해줘",
    expected: { domain: "OPERATIONS", taskType: "CI_CD_CONFIG" },
  },
  {
    prompt: "모니터링 설정 부탁해",
    expected: { domain: "OPERATIONS", taskType: "MONITORING_SETUP" },
  },

  // PLANNING (2)
  {
    prompt: "우선순위 정해줘",
    expected: { domain: "PLANNING", taskType: "PRIORITIZATION" },
  },
  {
    prompt: "리스크 분석 해줘",
    expected: { domain: "PLANNING", taskType: "RISK_ASSESSMENT" },
  },

  // REQUIREMENTS (2)
  {
    prompt: "요구사항 추출해줘",
    expected: { domain: "REQUIREMENTS", taskType: "REQUIREMENT_EXTRACTION" },
  },
  {
    prompt: "누락 확인해줘",
    expected: { domain: "REQUIREMENTS", taskType: "COMPLETENESS_CHECK" },
  },

  // DOCUMENTATION (2)
  {
    prompt: "API 문서화 진행해줘",
    expected: { domain: "DOCUMENTATION", taskType: "API_DOC" },
  },
  {
    prompt: "변경 로그 정리해줘",
    expected: { domain: "DOCUMENTATION", taskType: "CHANGELOG" },
  },

  // RESEARCH (2)
  {
    prompt: "호환성 확인해줘",
    expected: { domain: "RESEARCH", taskType: "COMPATIBILITY_CHECK" },
  },
  {
    prompt: "베스트 프랙티스 알려줘",
    expected: { domain: "RESEARCH", taskType: "BEST_PRACTICE" },
  },

  // COMMUNICATION (2)
  {
    prompt: "이 함수가 뭐야",
    expected: { domain: "COMMUNICATION", taskType: "EXPLAIN" },
  },
  {
    prompt: "영문 텍스트 번역해줘",
    expected: { domain: "COMMUNICATION", taskType: "TRANSLATE" },
  },
];
