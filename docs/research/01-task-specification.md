# 01. Task Specification — task 작성의 검증 근거

작성: 2026-04-25
범위: 호스트가 pyreez에 던지는 task 텍스트의 형식, 위치, 금지/필수 표현

---

## 1. Failure-condition framing (직시→발산형 전환)

### 출처
- **Liang et al., EMNLP 2024**, "Encouraging Divergent Thinking in Large Language Models through Multi-Agent Debate"
  - URL: https://aclanthology.org/2024.emnlp-main.992/
  - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- **Degeneration-of-Thought (DoT) 문제**: "once the LLM has established confidence in its solutions, it is unable to generate novel thoughts later through reflection even if its initial stance is incorrect"
- 즉 **directional 질문 ("X가 맞나?")**은 LLM이 빠르게 한 입장에 anchor → reflection으로도 변경 불가
- **MAD framework가 tit-for-tat 구조로 DoT를 깸**: 두 agent가 서로 반박하는 구조가 새 사고 생성 강제

### pyreez 적용
- 호스트가 task를 **"X가 틀린 시나리오를 구성하라. 구성 불가능하면 왜인지 논증"** 형태로 작성
- 이는 directional anchor를 차단하고 worker가 multiple paths 탐색하도록 강제
- 모든 프로토콜 공통 적용

### 예시
| 나쁨 (directional) | 좋음 (failure-condition) |
|---|---|
| "OIDC 도입해야 하나?" | "OIDC 도입이 12개월 내 운영 사고를 일으키는 시나리오를 구성하라" |
| "X 라이브러리 선택이 맞나?" | "X 라이브러리 선택이 향후 6개월 내 후회로 이어지는 조건은?" |
| "이 설계가 충분한가?" | "이 설계가 SLA를 못 지키는 트래픽 패턴을 구성하라" |

### 한계
- corpus 내 "directional 질문이 failure-condition 대비 정확히 몇 % 효과 저하"는 정량 측정 없음 — Liang 2024는 MAD 자체 효과 측정. failure-condition framing 단독 ablation은 없음.

---

## 2. False-premise 식별 명령

### 출처
1. **Sharma et al. (Anthropic), ICLR 2024**, "Towards Understanding Sycophancy in Language Models"
   - URL: https://openreview.net/forum?id=tvhaxkMKAn
   - 등급: [peer-reviewed]
2. **Nature npj Digital Medicine 2025**, "When helpfulness backfires"
   - URL: https://www.nature.com/articles/s41746-025-02008-z
   - 등급: [peer-reviewed]

### 논문이 직접 말한 것
- **Sharma 2024**: "five state-of-the-art AI assistants consistently exhibit sycophancy across four varied free-form text-generation tasks"; "both humans and preference models prefer convincingly-written sycophantic responses over correct ones a non-negligible fraction of the time"
- **Nature npj 2025**: 5 frontier LLM이 illogical medical request에 **"high initial compliance (up to 100%) across all models, prioritizing helpfulness over logical consistency"**

### pyreez 적용
- 호스트가 task에 명시적 false-premise 식별 명령 포함
- prompts.ts의 `HOST_INTERROGATION_SYSTEM`에 이미 부분 반영: *"If the question contains a false premise, identify it before answering"* (prompts.ts:407-410)
- 다른 프로토콜에도 확산 가치 (특히 high-stakes 도메인)

### 예시 표현
- "Before answering, check whether the task contains false premises (factually incorrect assumptions, contradictory constraints, undefined terms). If found, identify and address before proceeding."

### 한계
- Sharma 2024는 free-form generation, Nature 2025는 의료 도메인 — 일반 deliberation에 직접 적용 측정은 미수행
- false-premise 명령이 false negative (premise 있는데 못 짚음) vs false positive (premise 없는데 짚음) 비율 — corpus 직접 측정 없음

---

## 3. Lost-in-the-Middle: task는 user message 끝, 레퍼런스는 앞

### 출처
- **Liu et al., TACL 2024**, "Lost in the Middle: How Language Models Use Long Contexts"
  - URL: https://aclanthology.org/2024.tacl-1.9/
  - 등급: [peer-reviewed]
  - DOI: 10.1162/tacl_a_00638

### 논문이 직접 말한 것
- **U-shape position bias**: 긴 컨텍스트에서 정보 위치별 회수 성능이 처음/끝에서 높고 중간에서 가장 낮음
- 다양한 모델(open + closed) 일관 관찰
- multi-document QA, key-value retrieval 등 여러 task에서 검증

### pyreez 적용
- prompts.ts의 user message 구조: **레퍼런스(`<other-positions>`, `<your-previous>`, `<debate-so-far>`) → 제약/instructions → task** 순서
- prompts.ts:207 주석에 이미 명시: *"Reference data (long content) at top — Lost-in-the-Middle: push to start"*
- prompts.ts:184, 242, 285, 364, 397, 430, 511, 554, 573 — 모든 builder가 task를 마지막에 배치

### 예시 layout
```
[user message]
<other-positions>...</other-positions>          ← 앞 (recall 높음)
<your-previous>...</your-previous>
<host-instructions>...</host-instructions>
<analysis-lens>...</analysis-lens>              ← 중간 (recall 낮음 — 짧고 반복이라 OK)
<constraints>...</constraints>
[CONFIDENCE_AND_UNCERTAINTY]
<task>...</task>                                 ← 끝 (recall 높음)
```

### 한계
- 1M+ context (Claude 4.6, Gemini 3) 시대에 U-shape이 동일한 정도로 나타나는지는 **2026 시점 검증 부족**
- Liu 2024는 GPT-3.5/Claude-1 시대 모델 평가. reasoning model (o1, Claude 4.6 thinking)에서 U-shape 약화 가능성 — 별도 검증 필요

---

## 4. 1인칭 의견 박지 마라 (sycophancy trigger 회피)

### 출처
- **Sharma et al., ICLR 2024** (위와 동일)
- **arxiv 2602.23971 (preprint)**, "Ask don't tell: Reducing sycophancy in large language models"
  - URL: https://arxiv.org/html/2602.23971v2
  - 등급: [preprint]

### 논문이 직접 말한 것
- **2602.23971 (preprint)**: "statements, epistemic certainty and I-perspective framing drive sycophancy"; "question reframing greatly reduces model sycophancy"; "user reframing leads to small reductions in model sycophancy"
- 즉 1인칭 ("I think X") 표현이 모델로 하여금 사용자 입장 추종 강화

### pyreez 적용
- 호스트가 task에 "I believe X is correct, please verify" 류 1인칭 박지 마라
- 중립 명제로: "X holds when [조건]. Determine whether [조건] is satisfied."

### 한계
- 2602.23971은 preprint (peer-review 미확인) — 사용 시 [preprint] 라벨 필수
- Sharma 2024가 interaction framing 영향을 직접 다루지만 1인칭 vs 3인칭 ablation은 별도 measurement 필요

---

## 5. Reference data first, task last의 layout 정당화 (재인용)

본 문서 §3과 동일. 별도 출처 추가 없음.

---

## 6. XML 태그로 boundary 명시

### 출처
- **Anthropic 2026 official docs** (등급: [official-doc])
  - URL: https://docs.claude.com/en/docs/build-with-claude/prompt-engineering/use-xml-tags

### 공식 문서가 말한 것
- "Claude was specifically designed to parse XML-style tags"
- markdown header 또는 plain separator 대비 XML이 unambiguous boundary 제공
- 결과: clearer instructions, consistent output, better reasoning

### pyreez 적용
- prompts.ts의 모든 builder가 `<task>`, `<other-positions>`, `<constraints>`, `<analysis-lens>`, `<host-instructions>` 등 XML 사용
- 호스트가 task 작성 시도 XML 사용 권장 (예: `<context>...</context><decision>...</decision>`)

### 한계
- Anthropic 공식 문서 = vendor 자료. 다른 모델 (GPT-5, Gemini 3, Grok-4)에서도 XML이 markdown 대비 우수한지는 별도 검증 필요
- 공통 lowest-common-denominator로 XML 채택은 합리적이나 정량 비교 미수행

---

## 7. 자동주입 항목 중복 금지

### 정당화
- pyreez `prompts.ts`가 모든 round/protocol에 자동 주입하는 항목 (목록은 §8)
- 호스트가 task에 동일 내용 추가 = **over-prompting**
- 직접 corpus 근거: **Anthropic 2026 official docs**가 "the prompt engineering advice from 2023 is wrong for 2026's frontier models" 명시 — 과거의 verbose prompt 권고가 현 SOTA에서 counterproductive

### 보조 근거
- DSPy + HELM study (arxiv 2511.20836): 비구조적 prompt가 LM 성능 평균 4% 과소추정. 즉 **명확한 구조가 중요**, 과도한 텍스트는 noise
- Cemri ICLR 2025 ([B1]): "improvements in base model capabilities will be insufficient" — prompt 더 박는다고 해결 안 됨

### pyreez 자동주입 목록 (호스트가 중복 금지할 것)
| 자동주입 항목 | 위치 (prompts.ts) | 호스트가 task에 박지 말 것 |
|---|---|---|
| 3rd-person framing ("One analyst argues:") | line 91-99 (`formatOtherPositions`) | "다른 의견을 제3자처럼 객관적으로 봐라" |
| GLOBAL_DEPTH (factual grounding, uncertainty, premise rejection) | line 32-35 | "근거를 대고 답하라", "verify your facts" |
| ANTI_CONFORMITY (R2+) / ANTI_CONFORMITY_ADVERSARIAL | line 45-56 | "be objective", "다른 의견에 휘둘리지 마라" |
| CONFIDENCE_AND_UNCERTAINTY (HIGH/MED/LOW) | line 58-62 | "indicate your confidence" |
| DEPTH_EXPLORE (multiple approaches, self-rebuttal) | line 38-39 | "consider multiple perspectives", "think carefully" |
| DEPTH_REFINE (sequential_refinement) | line 41 | "improve while preserving" |
| DIVERSITY_LENSES (per-worker, shared_convergence R1/R2) | line 148-156 | "각 분석가는 다른 관점에서" |

### 한계
- 자동주입 항목이 호스트 instruction과 중복 시 정확히 어떤 효과 저하가 발생하는지 정량 측정 없음 — Anthropic 공식 가이드의 권고에 의존
