/**
 * Task classifier — hybrid keyword rules + (future) LLM fallback.
 * Phase 1: CLASSIFY from PLAN.md Section 6.
 */

import type {
  TaskDomain,
  TaskType,
  Complexity,
  Criticality,
  ClassifyResult,
} from "./types";

// -- Keyword rule map --

/**
 * Each entry: [taskType, keywords[]]
 * More specific patterns must come before general ones within a domain.
 */
type KeywordRule = readonly [TaskType, readonly string[]];
type DomainRules = readonly [TaskDomain, readonly KeywordRule[]];

const KEYWORD_RULES: readonly DomainRules[] = [
  // D6 TESTING — before CODING (to catch "테스트 작성" before "작성")
  [
    "TESTING",
    [
      ["EDGE_CASE_DISCOVERY", ["경계 케이스", "edge case", "엣지 케이스"]],
      ["TEST_CASE_DESIGN", ["테스트 설계", "test design", "테스트 케이스"]],
      [
        "UNIT_TEST_WRITE",
        [
          "테스트 작성",
          "테스트",
          "unit test",
          "write test",
          "spec 작성",
          "tdd",
        ],
      ],
      [
        "INTEGRATION_TEST_WRITE",
        ["통합 테스트", "integration test", "e2e"],
      ],
      ["COVERAGE_ANALYSIS", ["커버리지", "coverage"]],
      ["TEST_STRATEGY", ["테스트 전략", "test strategy"]],
      ["TEST_DATA_GENERATION", ["테스트 데이터", "test data"]],
    ],
  ],

  // D9 DEBUGGING — before CODING (to catch "에러 수정" before "수정")
  [
    "DEBUGGING",
    [
      ["ROOT_CAUSE", ["원인 분석", "root cause", "근본 원인", "에러 원인"]],
      [
        "ERROR_DIAGNOSIS",
        ["에러 분석", "에러 진단", "error diagnosis", "오류 분석"],
      ],
      ["LOG_ANALYSIS", ["로그 분석", "log analysis"]],
      ["REPRODUCTION", ["재현", "reproduce", "reproduction"]],
      ["FIX_PROPOSAL", ["수정안", "fix proposal"]],
      [
        "FIX_IMPLEMENT",
        ["버그 수정", "버그 fix", "fix", "수정", "debug", "디버그", "버그"],
      ],
      ["REGRESSION_CHECK", ["회귀", "regression"]],
    ],
  ],

  // D7 REVIEW
  [
    "REVIEW",
    [
      ["SECURITY_REVIEW", ["보안 리뷰", "보안 검토", "security review"]],
      [
        "PERFORMANCE_REVIEW",
        [
          "성능 리뷰",
          "성능 검토",
          "performance review",
          "성능 분석",
        ],
      ],
      ["DESIGN_REVIEW", ["설계 리뷰", "설계 검토", "design review"]],
      [
        "CODE_REVIEW",
        ["코드 리뷰", "코드 검토", "code review", "리뷰", "검토"],
      ],
      ["COMPARISON", ["비교", "compare", "comparison"]],
      ["CRITIQUE", ["비평", "비판", "critique"]],
      [
        "STANDARDS_COMPLIANCE",
        ["규칙 준수", "표준 준수", "standards", "compliance"],
      ],
    ],
  ],

  // D4 ARCHITECTURE
  [
    "ARCHITECTURE",
    [
      [
        "SYSTEM_DESIGN",
        ["시스템 설계", "system design", "아키텍처 설계", "아키텍처"],
      ],
      ["MODULE_DESIGN", ["모듈 설계", "module design", "컴포넌트 설계"]],
      [
        "INTERFACE_DESIGN",
        [
          "인터페이스 설계",
          "api 설계",
          "interface design",
          "api design",
        ],
      ],
      [
        "DATA_MODELING",
        [
          "데이터 모델",
          "data model",
          "erd",
          "스키마 설계",
          "schema design",
        ],
      ],
      ["PATTERN_SELECTION", ["디자인 패턴", "design pattern"]],
      [
        "DEPENDENCY_ANALYSIS",
        ["의존성 분석", "dependency analysis", "의존성"],
      ],
      [
        "MIGRATION_STRATEGY",
        ["마이그레이션", "migration", "이전 전략"],
      ],
      ["PERFORMANCE_DESIGN", ["성능 설계", "performance design"]],
    ],
  ],

  // D5 CODING
  [
    "CODING",
    [
      [
        "REFACTOR",
        ["리팩토링", "리팩터링", "refactor", "코드 정리", "코드 개선"],
      ],
      ["OPTIMIZE", ["최적화", "optimize", "성능 개선", "속도 개선"]],
      ["TYPE_DEFINITION", ["타입 정의", "type definition", "타입 작성"]],
      [
        "ERROR_HANDLING",
        ["에러 핸들링", "error handling", "예외 처리", "에러 처리"],
      ],
      ["SCAFFOLD", ["scaffold", "스캐폴드", "프로젝트 생성", "보일러플레이트"]],
      [
        "IMPLEMENT_ALGORITHM",
        ["알고리즘 구현", "알고리즘", "algorithm"],
      ],
      [
        "CONFIGURATION",
        ["설정 파일", "config 작성", "환경 설정", "configuration"],
      ],
      ["INTEGRATION", ["연동", "통합", "integration"]],
      ["CODE_PLAN", ["코딩 계획", "구현 계획", "code plan"]],
      [
        "IMPLEMENT_FEATURE",
        [
          "구현",
          "코드 작성",
          "코드",
          "작성",
          "implement",
          "create",
          "만들어",
          "개발",
          "기능",
        ],
      ],
    ],
  ],

  // D1 IDEATION
  [
    "IDEATION",
    [
      [
        "BRAINSTORM",
        ["브레인스토밍", "아이디어", "brainstorm", "발상", "idea"],
      ],
      ["ANALOGY", ["비유", "유추", "analogy"]],
      ["CONSTRAINT_DISCOVERY", ["제약 발견", "제약 조건", "constraint"]],
      ["OPTION_GENERATION", ["선택지", "대안", "option generation"]],
      ["FEASIBILITY_QUICK", ["실현 가능", "feasibility"]],
    ],
  ],

  // D10 OPERATIONS — before PLANNING ("배포 계획" must hit OPERATIONS, not PLANNING's "계획")
  [
    "OPERATIONS",
    [
      ["DEPLOY_PLAN", ["배포", "deploy", "deployment"]],
      ["CI_CD_CONFIG", ["ci/cd", "cicd", "ci cd", "파이프라인"]],
      ["ENVIRONMENT_SETUP", ["환경 설정", "environment setup"]],
      ["MONITORING_SETUP", ["모니터링", "monitoring"]],
      ["INCIDENT_RESPONSE", ["장애 대응", "incident", "사고 대응"]],
    ],
  ],

  // D2 PLANNING
  [
    "PLANNING",
    [
      ["PRIORITIZATION", ["우선순위", "priority", "prioritize"]],
      ["MILESTONE_PLANNING", ["마일스톤", "milestone", "로드맵", "roadmap"]],
      ["RISK_ASSESSMENT", ["리스크", "위험", "risk"]],
      ["RESOURCE_ESTIMATION", ["리소스 추정", "resource estimation", "공수"]],
      ["TRADEOFF_ANALYSIS", ["트레이드오프", "tradeoff"]],
      ["SCOPE_DEFINITION", ["범위 정의", "scope"]],
      [
        "GOAL_DEFINITION",
        ["목표 정의", "계획", "기획", "plan", "planning"],
      ],
    ],
  ],

  // D3 REQUIREMENTS
  [
    "REQUIREMENTS",
    [
      [
        "REQUIREMENT_EXTRACTION",
        ["요구사항 추출", "requirement extraction"],
      ],
      [
        "REQUIREMENT_STRUCTURING",
        ["요구사항 정리", "요구사항 구조", "requirement structuring"],
      ],
      [
        "AMBIGUITY_DETECTION",
        ["모호한 요구", "ambiguity", "모호"],
      ],
      [
        "COMPLETENESS_CHECK",
        ["누락 확인", "completeness", "빠진 요구"],
      ],
      ["CONFLICT_DETECTION", ["요구 충돌", "conflict"]],
      [
        "ACCEPTANCE_CRITERIA",
        ["인수 조건", "acceptance criteria", "요구사항", "스펙"],
      ],
    ],
  ],

  // D8 DOCUMENTATION
  [
    "DOCUMENTATION",
    [
      ["API_DOC", ["api 문서", "api doc", "api documentation"]],
      ["TUTORIAL", ["튜토리얼", "tutorial", "가이드", "guide"]],
      ["COMMENT_WRITE", ["주석", "comment"]],
      ["CHANGELOG", ["변경 로그", "changelog", "릴리즈 노트"]],
      ["DECISION_RECORD", ["의사결정 기록", "adr", "decision record"]],
      ["DIAGRAM", ["다이어그램", "diagram", "mermaid"]],
      ["API_DOC", ["문서 작성", "문서화", "documentation", "문서"]],
    ],
  ],

  // D11 RESEARCH
  [
    "RESEARCH",
    [
      ["BENCHMARK", ["벤치마크", "benchmark", "성능 비교"]],
      [
        "COMPATIBILITY_CHECK",
        ["호환성", "compatibility", "호환"],
      ],
      ["BEST_PRACTICE", ["베스트 프랙티스", "best practice", "모범 사례"]],
      ["TREND_ANALYSIS", ["트렌드", "trend"]],
      [
        "TECH_RESEARCH",
        ["리서치", "조사", "research", "기술 조사"],
      ],
    ],
  ],

  // D12 COMMUNICATION
  [
    "COMMUNICATION",
    [
      ["SUMMARIZE", ["요약", "summarize", "summary", "정리"]],
      ["EXPLAIN", ["설명", "explain", "알려줘", "뭐야"]],
      ["REPORT", ["리포트", "보고서", "report"]],
      ["TRANSLATE", ["번역", "translate", "translation"]],
      ["QUESTION_ANSWER", ["질문", "question", "답변"]],
    ],
  ],
] as const;

// -- Criticality defaults per domain --

const DOMAIN_CRITICALITY: Record<TaskDomain, Criticality> = {
  IDEATION: "low",
  PLANNING: "medium",
  REQUIREMENTS: "medium",
  ARCHITECTURE: "high",
  CODING: "medium",
  TESTING: "medium",
  REVIEW: "medium",
  DOCUMENTATION: "low",
  DEBUGGING: "medium",
  OPERATIONS: "high",
  RESEARCH: "low",
  COMMUNICATION: "low",
};

/** Specific task types with elevated criticality. */
const TASK_CRITICALITY_OVERRIDES: Partial<Record<TaskType, Criticality>> = {
  SECURITY_REVIEW: "critical",
  INCIDENT_RESPONSE: "critical",
  SYSTEM_DESIGN: "high",
  ROOT_CAUSE: "high",
  MIGRATION_STRATEGY: "high",
  FIX_IMPLEMENT: "medium",
};

// -- Complexity estimation --

/** Keywords indicating architectural/distributed complexity → force "complex". */
const COMPLEX_KEYWORDS: readonly string[] = [
  "아키텍처", "architecture",
  "마이크로서비스", "microservice",
  "분산 시스템", "distributed",
  "마이그레이션", "migration",
];

/** Keywords indicating security/middleware/multi-module work → at least "moderate". */
const MODERATE_KEYWORDS: readonly string[] = [
  "jwt", "인증", "auth", "oauth",
  "보안", "security",
  "암호화", "encrypt", "bcrypt", "hash",
  "xss", "csrf", "sql injection", "injection",
  "미들웨어", "middleware",
  "database", "데이터베이스",
  "concurrent", "병렬", "멀티스레드",
];

function estimateComplexity(
  prompt: string,
  criticality: Criticality,
): Complexity {
  // Step 1: Length-based baseline
  const len = prompt.length;
  let complexity: Complexity;
  if (len < 100) complexity = "simple";
  else if (len < 500) complexity = "moderate";
  else complexity = "complex";

  // Step 2: Keyword-based elevation
  const lower = prompt.toLowerCase();
  if (COMPLEX_KEYWORDS.some((kw) => lower.includes(kw))) {
    complexity = "complex";
  } else if (
    MODERATE_KEYWORDS.some((kw) => lower.includes(kw)) &&
    complexity === "simple"
  ) {
    complexity = "moderate";
  }

  // Step 3: Criticality floor — high/critical tasks are never "simple"
  if (
    (criticality === "critical" || criticality === "high") &&
    complexity === "simple"
  ) {
    complexity = "moderate";
  }

  return complexity;
}

// -- Criticality lookup --

function lookupCriticality(
  domain: TaskDomain,
  taskType: TaskType,
): Criticality {
  return TASK_CRITICALITY_OVERRIDES[taskType] ?? DOMAIN_CRITICALITY[domain];
}

// -- Public API --

/**
 * Classify a user prompt using keyword rules.
 * Returns null if no rules match (LLM fallback needed).
 */
export function classifyByRules(prompt: string): ClassifyResult | null {
  if (!prompt.trim()) return null;

  const lower = prompt.toLowerCase();

  for (const [domain, rules] of KEYWORD_RULES) {
    for (const [taskType, keywords] of rules) {
      if (keywords.some((kw) => lower.includes(kw))) {
        const criticality = lookupCriticality(domain, taskType);
        return {
          domain,
          taskType,
          complexity: estimateComplexity(prompt, criticality),
          criticality,
          method: "rule",
        };
      }
    }
  }

  return null;
}
