/**
 * Benchmark task definitions for measuring pyreez signal distributions.
 *
 * `expectedLevel` is the cross-judge consensus level observed in
 * bench/results/multi-provider-1 + judge-sonnet + judge-gemini-pro
 * (3 judges × 13 cases). 12/13 cases produced unanimous judge agreement;
 * 1 case (failure_bun) split between diverse and moderate — labeled
 * `diverse` to match the majority (haiku + gemini-pro).
 *
 * Earlier `expectedLevel` values were a priori guesses about how diverse
 * heterogeneous models would be. Measurement showed these guesses were
 * over-optimistic about disagreement: even controversial questions
 * (ethics, philosophy) produced HIGH semantic convergence across providers.
 * The labels below reflect actual observed behavior.
 */

export interface BenchCase {
  readonly id: string;
  readonly category: "obvious" | "directional" | "failure_cond" | "opinion" | "design" | "controversial";
  readonly task: string;
  readonly expectedLevel: "high" | "moderate" | "diverse";
}

export const BENCH_CASES: readonly BenchCase[] = [
  // obvious
  { id: "math_obvious", category: "obvious", task: "2 + 2 = 4인가? 답 끝에 confidence 명시.", expectedLevel: "high" },
  { id: "factual_who", category: "obvious", task: "Bun JavaScript runtime의 창시자는 누구인가? confidence 명시.", expectedLevel: "high" },
  { id: "factual_year", category: "obvious", task: "Node.js가 처음 발표된 연도는? confidence 명시.", expectedLevel: "high" },

  // directional — measured: workers actually agree on yes/no across providers
  { id: "directional_bun", category: "directional", task: "Bun이 새 백엔드 프로젝트에 좋은 선택인가? confidence 명시.", expectedLevel: "high" },
  { id: "directional_typed", category: "directional", task: "신규 Node 프로젝트에 TypeScript는 필수인가? confidence 명시.", expectedLevel: "high" },

  // failure_cond — split: open-ended failure-condition prompts produce DIVERSE,
  // but the microservices version converged because the standard tradeoffs
  // are well-known.
  { id: "failure_bun", category: "failure_cond", task: "Bun이 새 백엔드 프로젝트에서 실패하는 구체적 조건 3가지를 제시하라. confidence 명시.", expectedLevel: "diverse" },
  { id: "failure_microservices", category: "failure_cond", task: "Microservices 아키텍처가 monolith보다 나쁜 결과를 내는 구체적 조건 3가지. confidence 명시.", expectedLevel: "high" },

  // opinion — narrow constrained opinion converges; broad "best language"
  // is genuinely diverse.
  { id: "opinion_lang", category: "opinion", task: "2026년 새 프로젝트에서 가장 적합한 backend 언어는? confidence 명시.", expectedLevel: "diverse" },
  { id: "opinion_db", category: "opinion", task: "고가용성 트랜잭션 시스템에 가장 적합한 DB는? 단 하나만 골라라. confidence 명시.", expectedLevel: "moderate" },

  // design — workers converge on standard component sets/tradeoffs
  { id: "design_chat", category: "design", task: "100만 RPS 처리 가능한 채팅 서비스의 핵심 아키텍처 컴포넌트 5개를 설계하라. confidence 명시.", expectedLevel: "high" },
  { id: "tradeoff_arch", category: "design", task: "Microservices와 monolith 아키텍처의 핵심 tradeoff 3가지를 제시하라. confidence 명시.", expectedLevel: "high" },

  // controversial — measurement showed even ethics/philosophy converges
  // across heterogeneous providers; pre-RLHF positions overlap more than
  // expected.
  { id: "ethics_ai", category: "controversial", task: "강한 AI 모델은 오픈소스로 풀려야 하는가, 기업 통제 하에 있어야 하는가? 한 입장만 고르고 이유. confidence 명시.", expectedLevel: "high" },
  { id: "philosophy_freewill", category: "controversial", task: "자유의지는 존재하는가? Yes 또는 No 중 하나 골라서 논증하라. confidence 명시.", expectedLevel: "high" },
];
