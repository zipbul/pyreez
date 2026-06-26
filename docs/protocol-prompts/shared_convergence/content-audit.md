# shared_convergence prompt content audit

Fragment 단위 텍스트 quality 검토. word-level / sentence-level / threshold / ambiguity / negative example / cross-model interpretation. plan.md(structure 진단)과 별개.

**모든 행동 영향 주장은 [추정]**. pyreez bench 측정 0. text-level ambiguity는 코드 read로 재현 가능.

---

## 1. `GLOBAL_DEPTH` (`prompts.ts:32-35`)

원문:
```
Ground factual claims in specific evidence. For speculative ideas, state the reasoning chain.
If a premise is flawed, reject it — do not build on a broken foundation.
Express uncertainty where it exists. Do not force confidence on ambiguous points.
Before finishing, verify your key claims.
```

발견:

- **"specific evidence"**: 어떤 수준이 specific인가? URL? paper? prod metric? threshold 없음. 모델 해석 다양 [추정]
- **"reasoning chain"**: 길이·구조 무규정. 한 줄 vs 단계 list 차이 부재
- **"flawed premise"**: 결함 기준 모호. "잘못된 전제"가 사실 오류만인지, 모호한 framing 포함인지 불명
- **"reject" vs "address"**: 거부 후 작업 진행 가능한지 명시 없음. 일부 워커 "reject 후 가설로 진행" vs "stop and report" 차이
- **"verify your key claims"**: 무엇이 key인가? 검증 방법 무규정 — verification step이 lip-service 가능. 워커가 "verified ✓"만 적고 실제 검증 안 하는 패턴 발생 가능 [추정]

영향 (가설): "evidence ground" 강제하지만 기준 약해 형식적 인용으로 흐를 가능성. verify는 일반론으로 끝남.

개선 후보 (가설, 측정 필요):
- "specific evidence" → "concrete evidence: a measurable result, a primary source URL, a documented prod incident, or a spec section. Generic statements like 'studies show' do not count."
- "verify your key claims" → "Before finishing, list your top 3 claims; for each, name the specific evidence or reasoning step. If any claim has no support, mark it as speculation or remove it."

---

## 2. `DEPTH_EXPLORE` (`prompts.ts:38-39`)

원문:
```
Consider multiple approaches before committing. Discard the weakest before finalizing.
After reaching your position, find the strongest argument against it. If you cannot defend against it, revise.
```

발견:

- **"multiple"**: N=2도 multiple. 임계 없음. 워커가 2개만 비교하고 "considered multiple" 선언 가능
- **"weakest" 비교 기준 부재**: 무엇으로 약함을 판정? 비용? 위험? 일반화 가능성? 워커별 weight 다르면 결과 다름
- **"strongest argument against"**: 가장 강한 반론 1개만? 여러 개? 단수형
- **"cannot defend"**: 방어 실패 기준 모호. 부분 방어도 defend로 해석 가능
- **"revise"**: 어느 정도 revise? 완전 재작성 vs 미세 조정 무규정

영향 (가설): exploration이 형식적이 될 수 있음. 워커가 1개 strong + 1 strawman으로 "multiple considered" 충족하고 종료.

개선 후보 (가설):
- "multiple approaches" → "at least 3 distinct approaches"
- "weakest" → "the approach with the most concrete failure modes under your task's constraints"
- "strongest argument against" → "the strongest concrete counter-evidence (a failure case, a contradicting result, or a missed constraint)"

---

## 3. `ANTI_CONFORMITY` (`prompts.ts:45-49`)

원문:
```
Assess discrepancies between your analysis and others' using specific evidence.
Change your position only when evidence against your analysis is clear.
State what specific evidence or logic led you to agree or disagree.
Do not rely on conformity, consensus, or social pressure.
When others report their confidence, weigh their evidence against their stated certainty: high-confidence claims with weak evidence are red flags; low-confidence claims with strong evidence deserve attention.
```

발견:

- **"clear evidence"**: clear 기준 부재. "분명한" 정도 모호. 워커가 weak evidence를 clear로 해석 가능
- **"rely on" vs "consider"**: conformity를 considering은 OK인지 명시 없음. 미세한 해석 차이
- **"social pressure"**: LLM 컨텍스트에 social pressure 의미 모호 (실제 사람 아님)
- **"red flags" / "deserve attention"**: 발견 후 행동 미규정. "주목"이 입장 변경? 보고만? 무동작?
- **5번째 문장이 거의 4문장**: 단일 fragment에 confidence 비교 룰까지 묶임. role focus dilution 가능

영향 (가설): 텍스트는 anti-conformity 의도지만 threshold·action이 약해 워커가 default behavior 유지하기 쉬움.

개선 후보 (가설):
- "clear evidence" → "evidence that names a specific failure case, contradicting result, or missed constraint in your position"
- "do not rely on conformity" → "If you agree with the majority, the agreement must come from independent reasoning. State the specific evidence that led you to agree, separately from the fact that others agreed."
- confidence 평가 부분을 별도 fragment로 분리 (현재 5번 문장 너무 길음)

---

## 4. `CONFIDENCE_AND_UNCERTAINTY` (`prompts.ts:58-62`)

원문:
```
For each major claim, indicate your confidence:
- HIGH: strong evidence or direct expertise
- MEDIUM: reasonable inference but limited evidence
- LOW: speculative or uncertain
Do not force confidence — if genuinely uncertain, say so.
```

발견:

- **"strong evidence or direct expertise"**: LLM은 "direct expertise" 보유 X (학습 데이터 기반). 카테고리 자체가 LLM에 부적합
- **calibration 부재**: HIGH = 90%+? 75%+? 정량 매핑 없음 → 모델별 임계 다양 [추정 — RLHF overconfidence 통설]
- **"major claim"**: major 기준 무규정. 워커가 결론 한 줄만 HIGH 표기 vs 모든 문장에 표기 가능
- **"force confidence"**: force와 정직 표기의 경계 모호
- **3 단계만**: 90% 와 99% 둘 다 HIGH. 강한 자신과 거의 확실의 구분 불가. 의료/법률 task에선 위험

영향 (가설): self-reported confidence calibration 약함. parseConfidence가 빈도 채택해도 본문 빈도가 결론 confidence와 다름 가능.

개선 후보 (가설):
- "HIGH/MEDIUM/LOW" 정의를 verbalized probability로 교체: "HIGH = you would bet your reputation (≥80% certain), MEDIUM = 50-80%, LOW = <50% or speculative"
- "direct expertise" 삭제 (LLM에 부적합)
- 결론 표기 vs inline 표기 위치 규정: "End with one line: `final_confidence: HIGH|MEDIUM|LOW`. Inline confidence in analysis above is auxiliary."

---

## 5. `DIVERSITY_LENSES` 7개 (`prompts.ts:148-156`)

원문 (verbatim, 각 lens):

1. `Prioritize practical constraints: cost, timeline, team capability, migration effort. What looks good on paper but fails in practice?`
2. `Prioritize long-term consequences: maintenance burden, scalability ceiling, ecosystem trajectory, lock-in risk. What decision will you regret in 2 years?`
3. `Prioritize risk and failure modes: what can go wrong, what are the hidden assumptions, what happens under adversarial conditions? Steelman the weakest option.`
4. `Prioritize the contrarian view: argue for the less obvious choice. What is everyone else missing? What evidence contradicts the popular opinion?`
5. `Prioritize first principles: strip away convention and trend. What does the fundamental problem actually require? Rebuild the analysis from constraints alone.`
6. `Prioritize human factors: developer experience, onboarding, cognitive load, error-proneness. The best architecture that nobody can use correctly is the worst architecture.`
7. `Prioritize empirical evidence: cite specific benchmarks, case studies, production incidents, or measured data. Reject claims without evidence.`

발견:

- **lens 1 (practical) vs lens 6 (human factors)**: overlap. "team capability"·"migration effort"(1) vs "developer experience"·"onboarding"(6) — 운영 관점에서 중첩
- **lens 3 (risk) vs lens 5 (first principles)**: lens 3은 failure modes, lens 5는 constraints. 일부 워커가 둘 다 "what could go wrong + fundamental requirements" 동일 출력 가능
- **lens 4 (contrarian)**: "less obvious choice"가 어떤 task에선 unsafe 결정으로 흐를 위험. 적절성 task-dependent
- **lens 7 (empirical evidence)**: "Reject claims without evidence"는 다른 lens와 양립 X (lens 1·2·4·5는 본질적으로 evidence 약함). 워커가 lens 7 받으면 다른 lens 영역 분석 거부 가능
- **lens별 길이 불균등**: lens 1-2는 1.5문장, lens 3-7은 2-3문장. cognitive load 비대칭
- **"Prioritize X"** 시작 통일: structure consistent. 그러나 후반 instruction이 lens마다 다른 형태 (질문 vs 명령). 일관성 약함
- **lens 텍스트가 무엇을 산출하라는 명시 부재**: "Prioritize" 만으로는 출력 형태 무규정. 워커마다 lens 적용 결과가 매우 다르게 표현 가능 [추정]

영향 (가설): lens가 실제로 서로 다른 출력 유도하는지 측정 0. lens 4·7이 다른 lens와 호환 안 되는 instruction 포함 → workerIndex에 따라 분석 차원 자체가 무력화 가능.

개선 후보 (가설, 측정 필요):
- lens 1 vs 6 merge 또는 명확 분리 (운영비 vs DX·UX)
- lens 4 (contrarian) 적용 task 제한 명시
- lens 7 "Reject claims without evidence"를 "When evidence is missing, mark the claim as speculation"로 완화
- 각 lens 끝에 "Output format: 2-3 specific findings from this lens" 같은 출력 명시
- lens 길이 표준화 (각 1-2문장 + 핵심 질문 1개)

---

## 6. `SHARED_CONVERGENCE_SYSTEM` role description (`prompts.ts:141-144`)

원문:
```
Think deeply, present concisely. No preamble — lead with your position.
```

발견:

- **"Think deeply, present concisely"**: 모순 가능. 워커가 deep thinking 출력하면 verbose, concise 출력하면 shallow 보임. trade-off 규정 없음
- **"position"**: position이 의견? 결정? 가설? 모호
- **"lead with"**: 첫 문장? 첫 단락? 첫 섹션? 정확한 위치 무규정

영향 (가설): "Think deeply"가 inner reasoning을 prompt에서 요구하는 건지, 출력에 포함하라는 건지 모호. 모델별 해석 다양.

개선 후보:
- "Think deeply" 삭제 (Anthropic·OpenAI 가이드: prompt에 thinking instruction 박지 마라 — vendor parameter 사용). pyreez CLAUDE.md `<harness>` 룰과 일치
- "present concisely" → "Output: position statement (1-2 sentences) → reasoning (2-4 paragraphs) → evidence."
- "lead with your position" → "First sentence states your position. Subsequent paragraphs justify."

---

## 7. XML tag 명명

원문 사용 태그: `<role>`, `<task>`, `<host-instructions>`, `<analysis-lens>`, `<constraints>`, `<other-positions>`, `<your-previous>`, `<debate-so-far>`

발견:

- **`<role>`**: system 안에 role description 박는 패턴. system 자체가 role 정의니 redundant. 단 cross-model XML parsing 보조 — 유지 정당화
- **`<task>`**: 이름 적절. 단 R2+에서 마지막 위치 — 명확
- **`<host-instructions>`**: 워커가 "host"가 누구인지 모름. "User"와 host 구분 모호. "host"는 pyreez 내부 용어
- **`<analysis-lens>`**: 워커가 다른 워커도 다른 lens 받았다는 사실 인지 X (plan.md M4'과 연결). 명명만으론 차별성 명시 안 됨
- **`<constraints>`**: 일반적. 단 `<rules>`, `<guidelines>` 등과 차이 무명시 — vendor별 해석 차 [추정]
- **`<other-positions>`**: 의미 명확. 단 "positions" 단수/복수 혼란 가능
- **`<your-previous>`**: 의미 불완전. "your previous what?" — `<your-previous-position>` 또는 `<your-prior-analysis>`가 정확
- **`<debate-so-far>`**: "debate"가 shared_convergence 모드와 불일치. shared_convergence는 debate 아닌 협의 — adversarial_debate에서 가져온 명명

영향 (가설): tag 명명의 의미 정확성이 모델 attention과 interpretation에 영향 [추정 — cross-model XML interpretation 통설]. `<debate-so-far>`는 의도와 다른 행동 유도 가능.

개선 후보:
- `<host-instructions>` → `<additional-instructions>` 또는 `<task-context>`
- `<your-previous>` → `<your-prior-analysis>`
- `<debate-so-far>` → `<deliberation-so-far>` (protocol-neutral) 또는 protocol별 분기 (shared는 `<positions-so-far>`, adversarial은 `<debate-so-far>`)

---

## 8. Inline directives

원문:
- R1: `Explore broadly. Do not converge prematurely.`
- 마지막 라운드: `This is the final round. Commit to your strongest position.`

발견:

- **"Explore broadly"**: broadly 임계 없음. R1 응답이 "broad enough" 자기 판정 모호
- **"converge prematurely"**: premature 기준 없음. R1에서 합리적 결론 도출이 prematurely로 해석될 위험
- **"This is the final round"**: 사실 알림. 정상
- **"Commit to your strongest position"**: CONFIDENCE_AND_UNCERTAINTY의 "Do not force confidence"와 충돌 (plan.md D2)

개선 후보 (가설):
- "Explore broadly" → "In R1, output at least 3 distinct candidate positions before selecting one. Diversity matters more than depth in R1."
- "Commit to your strongest position" → "State your final answer. Preserve LOW confidence on points where evidence remains insufficient — do not inflate certainty to close the deliberation."

---

## 9. 3rd-person template (`prompts.ts:96`)

원문:
```
One analyst argues${conf}:
${content}
```

발견:

- **"One analyst"**: 단수형. 다중 워커 응답 list에 모두 "One analyst" 반복 → indistinguishable. 워커가 어느 응답이 누구인지 구분 X (의도된 anonymization vs 손실)
- **"argues"**: contentious framing. shared_convergence(협의)에 "argues"가 부적절. adversarial과 동일 워딩
- **`${conf}`**: "(their confidence: HIGH)" 형식. 워커가 자기 confidence vs others 비교 가능 — 단 confidence inflation 유인 가능 [추정]

개선 후보:
- shared_convergence 전용 template: "Analyst ${idx} ${conf} states:" — 단 anonymization 손실
- 또는 "One independent analyst argues" — pyreez 컨텍스트 명시 (사람 아닌 LLM agent)
- "argues" → "states" (협의 모드 적합)

---

## 10. Negative example 부재

원문 전체: positive instruction만. negative example("don't do this") 부재.

발견:

- 워커가 "wrong output" 무엇인지 모름. shared-convergence.md(playbook)에 `<bad-example>` 가이드 있으나 task 안에 host가 박을 책임 — system/harness 자동 주입 X
- high-stakes task(의료·법률)에서 default workflow에 negative example 부재 → host 책임으로만 위임

영향 (가설): consistent failure mode (예: 일반론으로 빠짐, persona simulation, false consensus)에 대한 가드 부재.

개선 후보:
- harness에 task-class별 negative example library 추가 — 단 자동 매칭 비용 큼
- 또는 task 자동 분류 후 도메인별 negative example 주입 — 별도 작업

---

## 11. 한국어 task ↔ 영문 prompt content 충돌

원문: 모든 fragment 영문.

발견:

- pyreez 사용자가 한국어 task 주면 워커는 한국어 응답 가능. 그러나 system/user 메시지 자체가 영문 → 모델 internal language switching 비용 [추정]
- 한국어 confidence marker는 코드에서 `신뢰도:` 지원(`engine.ts:185`). 그러나 prompt가 영문 HIGH/MEDIUM/LOW 요구 → 워커가 영문 표기 default
- task 안의 한국어 키워드("실패 조건", "구체 조건")가 영문 lens·constraint와 의미 align 안 될 수 있음

영향 (가설): 다국어 task에 prompt 효과 약화. 측정 0.

개선 후보 (가설):
- 다국어 detection 후 prompt 분기 — 큰 변경
- 또는 prompt content는 영문 유지 + 한국어 task 워커에 "Match the language of the task in your response" anchor 추가

---

## Sentence-level ambiguity 종합

`prompts.ts`의 fragments에서 발견된 임계·기준 부재 표현:

- "specific evidence" — specific 임계 부재
- "strong evidence" — strong 임계 부재
- "weakest" — 비교 기준 부재
- "multiple" — 수 임계 부재
- "clear" — clear 임계 부재
- "broadly" — broadly 임계 부재
- "key claims" — key 임계 부재
- "premature" — premature 임계 부재
- "deeply" / "concisely" — 임계 부재

→ 10+ 임계 부재 표현. 측정 가능한 기준 부재로 워커 해석 다양화 추정.

---

## 결론

prompt content audit 결과:

| 영역 | 발견 |
|---|---|
| Fragment text quality | 10+ 임계·기준 부재 표현. ambiguity 광범위 |
| Lens 텍스트 | lens 1·6 overlap, lens 4·7 호환 부재, 길이 비대칭 |
| Role description | "Think deeply"가 vendor 가이드 위반 (prompt에 thinking instruction 박지 마) |
| XML tag 명명 | `<debate-so-far>`가 shared_convergence 모드와 불일치. `<your-previous>` 명명 불완전 |
| Inline directives | "Commit to strongest position"이 CONFIDENCE와 충돌 (구조 진단과 일치) |
| 3인칭 template | "argues"가 협의 모드 부적합 |
| Negative example | 부재 — host 책임 |
| 다국어 | 한국어 task에 영문 prompt 효과 약화 가능 |

## 사실 vs 가설 분류

**사실 (코드 read·grep 재현 가능)**:
- 임계·기준 부재 표현 list (텍스트 read 사실)
- lens 텍스트 길이 비대칭 (counting)
- lens 4·7 호환 부재 (텍스트 의미 read)
- "Think deeply" 존재 (text fact)
- XML tag 명명 (text fact)
- Negative example 부재 (text fact)
- 다국어 mismatch (text vs cli runtime fact)

**가설 (측정 없음)**:
- 위 모든 발견이 실제 워커 출력 품질에 미치는 영향
- 개선 후보 텍스트가 더 나은 결과를 내는지
- 모델별 interpretation 차이 (Claude/GPT/Gemini)

## 적용 제약

위 audit은 fragment 텍스트의 **재현 가능 ambiguity 진단**. 개선 텍스트 적용은 모두 hypothesis → 측정 인프라 없이는 v2 plan의 Tier 3 룰 적용 (보류). dead-metric 패턴 회피.

## 측정 가능 가설 list

bench/ 활성화 후 검증할 가설 (우선순위):

1. **임계 정량화 vs verbose**: "specific evidence" → "evidence with URL/spec section/prod metric" 변경이 evidence 인용 빈도·품질 향상하는가
2. **lens 텍스트 표준화**: 길이 표준화 + 출력 명시가 lens별 출력 특성 차별화 향상하는가
3. **"Think deeply" 제거**: vendor reasoning parameter 활용 + prompt instruction 제거가 출력 품질 동일·향상하는가
4. **CONFIDENCE 정량 매핑**: HIGH/MED/LOW를 verbalized probability로 교체가 calibration 향상하는가
5. **XML tag 명명**: `<your-prior-analysis>` vs `<your-previous>`가 모델 해석 차이 만드는가
6. **3인칭 "argues" → "states"**: 협의 모드에서 sycophancy 증감 측정

bench/ 활성화는 별도 작업.
