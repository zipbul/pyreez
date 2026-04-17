/**
 * Benchmark task definitions for measuring pyreez signal distributions.
 *
 * Categories cover the convergence spectrum:
 * - obvious: factual/mathematical questions where HIGH semantic convergence is expected
 * - directional: yes/no or evaluative questions that should converge but at score < 0.7
 * - failure_cond: failure-condition prompts that should produce DIVERSE
 * - opinion: subjective questions where MODERATE/DIVERSE is expected
 * - design: open-ended design questions where multiple valid answers exist
 * - controversial: ethics/philosophy where DIVERSE is the expected ground truth
 *
 * Each case ships an `expectedLevel` for ground-truth comparison when running
 * accuracy measurements against the LLM judge's output.
 */

export interface BenchCase {
  readonly id: string;
  readonly category: "obvious" | "directional" | "failure_cond" | "opinion" | "design" | "controversial";
  readonly task: string;
  readonly expectedLevel: "high" | "moderate" | "diverse";
}

export const BENCH_CASES: readonly BenchCase[] = [
  // obvious — should converge HIGH
  { id: "math_obvious", category: "obvious", task: "2 + 2 = 4인가? 답 끝에 confidence 명시.", expectedLevel: "high" },
  { id: "factual_who", category: "obvious", task: "Bun JavaScript runtime의 창시자는 누구인가? confidence 명시.", expectedLevel: "high" },
  { id: "factual_year", category: "obvious", task: "Node.js가 처음 발표된 연도는? confidence 명시.", expectedLevel: "high" },

  // directional — yes/no
  { id: "directional_bun", category: "directional", task: "Bun이 새 백엔드 프로젝트에 좋은 선택인가? confidence 명시.", expectedLevel: "moderate" },
  { id: "directional_typed", category: "directional", task: "신규 Node 프로젝트에 TypeScript는 필수인가? confidence 명시.", expectedLevel: "moderate" },

  // failure_cond — should produce concrete differing conditions
  { id: "failure_bun", category: "failure_cond", task: "Bun이 새 백엔드 프로젝트에서 실패하는 구체적 조건 3가지를 제시하라. confidence 명시.", expectedLevel: "diverse" },
  { id: "failure_microservices", category: "failure_cond", task: "Microservices 아키텍처가 monolith보다 나쁜 결과를 내는 구체적 조건 3가지. confidence 명시.", expectedLevel: "diverse" },

  // opinion — subjective
  { id: "opinion_lang", category: "opinion", task: "2026년 새 프로젝트에서 가장 적합한 backend 언어는? confidence 명시.", expectedLevel: "moderate" },
  { id: "opinion_db", category: "opinion", task: "고가용성 트랜잭션 시스템에 가장 적합한 DB는? 단 하나만 골라라. confidence 명시.", expectedLevel: "moderate" },

  // design — multiple valid answers
  { id: "design_chat", category: "design", task: "100만 RPS 처리 가능한 채팅 서비스의 핵심 아키텍처 컴포넌트 5개를 설계하라. confidence 명시.", expectedLevel: "moderate" },
  { id: "tradeoff_arch", category: "design", task: "Microservices와 monolith 아키텍처의 핵심 tradeoff 3가지를 제시하라. confidence 명시.", expectedLevel: "moderate" },

  // controversial — should be DIVERSE
  { id: "ethics_ai", category: "controversial", task: "강한 AI 모델은 오픈소스로 풀려야 하는가, 기업 통제 하에 있어야 하는가? 한 입장만 고르고 이유. confidence 명시.", expectedLevel: "diverse" },
  { id: "philosophy_freewill", category: "controversial", task: "자유의지는 존재하는가? Yes 또는 No 중 하나 골라서 논증하라. confidence 명시.", expectedLevel: "diverse" },
];
