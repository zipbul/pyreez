# adversarial_debate — system-xml 패치 콘텐츠 품질 평가

## 1. 2-way 구성표

| 항목 | after-dedup (baseline) | after-system-xml (patch) |
|---|---|---|
| 캡처 파일 | `worker-live-after-dedup.md` | `worker-live-system-xml.md` |
| task | PostgreSQL vs MongoDB 3 조건 (동일) | 동일 |
| workerInstructions | "Cite a benchmark, official source, or production case" (동일) | 동일 |
| 모델 | `anthropic/claude-haiku-4.5`, `openai/gpt-5.4-mini` | 동일 |
| protocol | `adversarial_debate` | 동일 |
| maxRounds | 2 | 2 |
| reasoning_effort | unset (vendor default) | unset (vendor default) |
| 총 LLM call | 4 (R1×2 + R2×2) | 4 (R1×2 + R2×2) |
| 패치 대상 | — | `prompts.ts` `GLOBAL_DEPTH` → `<grounding>`/`<completion-check>` XML 블록 + `ANTI_CONFORMITY_ADVERSARIAL` 에 "cheapest evidence test that would falsify it" 라인 추가 |

캡처 방식: Option A — `providerRegistry.chat` 을 `/tmp` 래퍼로 가로채 `req.messages` + `ChatCompletionResponse` snapshot. 둘 다 동일 방식.

## 2. 7-dim 점수표 (1-5 scale, 5=best)

평가 대상은 **worker assistant text only** (system / user prompt 제외). 정량 지표는 grep 카운트, 정성 지표는 본문 직접 읽기 기반.

각 행: `call#:model:round`. baseline / system-xml 두 버전.

| call | version | 1. Evidence density | 2. Falsifiability | 3. Steelman | 4. Concession | 5. Structure | 6. Reasoning depth | 7. Filler ratio | row total |
|---|---|---|---|---|---|---|---|---|---|
| 1: haiku, R1 | after-dedup     | 2 | 1 | 3 | 1 | 5 | 3 | 3 | 18 |
| 1: haiku, R1 | after-system-xml | 2 | 1 | 3 | 1 | 5 | 3 | 3 | 18 |
| 2: codex, R1 | after-dedup     | 4 | 1 | 2 | 1 | 4 | 3 | 4 | 19 |
| 2: codex, R1 | after-system-xml | 5 | 1 | 3 | 1 | 4 | 4 | 4 | 22 |
| 3: codex, R2 | after-dedup     | 1 | 1 | 4 | 3 | 3 | 3 | 3 | 18 |
| 3: codex, R2 | after-system-xml | 5 | 4 | 4 | 2 | 4 | 4 | 4 | 27 |
| 4: haiku, R2 | after-dedup     | 4 | 1 | 2 | 4 | 5 | 3 | 3 | 22 |
| 4: haiku, R2 | after-system-xml | 1 | 4 | 5 | 4 | 5 | 4 | 4 | 27 |

근거 (정량):

| 측정 | baseline | system-xml |
|---|---|---|
| URL 총합 (PCRE `https?://[^\s)\]"]+`) | 16 (call2=7, call4=9) | 32 (call2=13, call3=19) |
| 'falsif*' / 'cheapest' / 'would change my mind' 총합 | 0 | 7 (call3=3, call4=4) |
| steelman 키워드 총합 | 6 | 11 |
| concession 키워드 총합 | 7 | 4 |
| 단어 수 총합 | 2661 | 2815 (+5.8%) |

R1 (call 1, 2)는 두 트레이스가 사실상 동일 prompt를 받음 (system XML 차이만). R2 (call 3, 4)는 falsification 라인이 user constraints에 들어가 직접 효과 측정 가능.

## 3. 차원별 aggregate delta (system-xml − dedup)

| 차원 | baseline 평균 | system-xml 평균 | Δ |
|---|---|---|---|
| 1. Evidence density | 2.75 | 3.25 | **+0.50** |
| 2. Falsifiability | 1.00 | 2.50 | **+1.50** |
| 3. Steelman | 2.75 | 3.75 | **+1.00** |
| 4. Concession | 2.25 | 2.00 | −0.25 |
| 5. Structure | 4.25 | 4.50 | +0.25 |
| 6. Reasoning depth | 3.00 | 3.75 | **+0.75** |
| 7. Filler ratio | 3.25 | 3.75 | +0.50 |
| **row total 평균** | **19.25** | **23.50** | **+4.25** |

가장 큰 게인: Falsifiability (+1.50), Steelman (+1.00), Reasoning depth (+0.75). Concession 만 -0.25 — system-xml 트레이스는 falsification frame을 잡느라 "i agree" 류 명시적 양보 횟수가 줄었음. 다만 call 4는 양보를 더 정밀화 ("Concession narrowness: Valid for a team-specific decision, invalid for a general default") — 횟수보다 질이 좋다.

## 4. 토큰 비용 delta

JSON usage 합계:

| 지표 | after-dedup | after-system-xml | Δ |
|---|---|---|---|
| prompt_tokens | 110,080 | 70,303 | **−36.1%** |
| completion_tokens | 24,803 | 13,564 | **−45.3%** |
| cached_tokens | 20,224 | 23,296 | +15.2% |

prompt 절감은 codex/gpt-5.4-mini 호출에서 모델 측 reasoning 호출 양식이 다른 데 기인 (R1 codex baseline 56604 → system-xml 32925, R2 codex baseline 47556 → system-xml 31141). 패치는 system 메시지 ~50 토큰 추가 + constraints 1 라인 추가 (수 토큰)이므로 패치 자체가 prompt를 줄인 것은 아니다 — codex CLI 측에서 자동 캐싱/요약을 다르게 처리한 것으로 보임 (`docs/protocol-prompts/adversarial_debate/worker-live-system-xml.md` per-call usage 표 참조).

핵심: **completion_tokens 가 늘지 않았다** (오히려 −45%). "effort=high 비용 없이 품질 상승" 조건 충족.

## 5. Falsification + URL count 비교 (Step 3 hypothesis 검증)

| 가설 | 결과 |
|---|---|
| (a) `falsif*` / "cheapest" / "would change my mind" 발생 증가 | **PASS**: 0 → 7. R2 call 3, 4 에서만 발현 (R2 user-constraints 에 falsification 라인이 들어가는 라운드와 일치) |
| (b) URL citation density 감소하지 않음 | **PASS**: 16 → 32 (정확히 2배). R2 codex가 MongoDB/PostgreSQL 공식 문서 + mdpi.com 벤치마크를 더 많이 인용 |
| (c) 토큰 비용 의미있게 증가하지 않음 | **PASS**: completion_tokens −45%, prompt_tokens −36%. effort 구매 없음 |

3개 모두 통과.

## 6. Verdict

**시스템-xml 패치는 reasoning_effort 인상 없이 워커 응답 콘텐츠 품질을 측정 가능한 수준으로 향상시켰다.**

- 7-dim 평균 총점 19.25 → 23.50 (+22%).
- 핵심 게인은 falsifiability/steelman/reasoning-depth — 정확히 패치 의도와 일치하는 차원.
- 비용은 오히려 감소 (codex 측 캐싱 변화 영향 큼; 패치 자체가 비용 효과는 아니지만 cost를 늘리지 않은 것은 명확).
- 단 R1 (call 1, 2) 에서는 falsifiability/concession 변화 없음 — falsification 라인이 R2 ANTI_CONFORMITY_ADVERSARIAL 에만 추가됐기 때문 (R1 system은 `<grounding>` 효과만 받음, evidence density/steelman 약간 향상).

약점:

- 단일 task 단일 실행 비교. variance 미측정. 동일 task 3회 재실행해야 진짜 우열 판정 가능.
- concession 횟수는 감소 — falsification 프레임이 명시적 양보를 누른 trade-off일 가능성.
- prompt_tokens 큰 감소는 codex CLI 측 동작 변화일 수 있고 (re-run 마다 변동), 패치 효과로 귀속 불가.

## 7. 직접 인용 — 패치 효과 근거

### 7.1 Falsifiability 신규 출현 (after-system-xml call 3, codex R2)

```
Cheapest falsification test: take one real planned schema change, implement it on staging in PostgreSQL, and measure deploy time plus rollback risk. If it is a fast additive change, the "migration overhead" claim weakens sharply.
```

```
Cheapest falsification test: run a 2-day spike implementing the top 3 queries and one migration path in PostgreSQL and MongoDB, then compare defects, query complexity, and PR churn.
```

```
Cheapest falsification test: build the same minimal CDC consumer on both and measure time-to-first-working-sync.
```

→ baseline call 3 (codex R2) 에는 동일 위치에 falsification test 없음 (grep 0).

### 7.2 Falsifiability 출현 (after-system-xml call 4, haiku R2)

```
**Cheapest test to falsify this analysis**: Show me a 4-person SaaS MVP that actually needed MongoDB's flexibility or scaling, not PostgreSQL + JSONB + managed hosting. I predict you can't, because the teams that do choose MongoDB usually regret denormalization complexity by month 4.
```

→ baseline call 4 에는 동일 표현 없음 (Strongest Argument Against 섹션은 있으나 falsification test 형식 아님).

### 7.3 URL 인용 밀도 증가 (after-system-xml call 2, codex R1)

```
[MongoDB flexible schema / validation](https://www.mongodb.com/docs/manual/core/schema-validation/), [MongoDB schema design process](https://www.mongodb.com/docs/manual/data-modeling/schema-design-process/)
[MongoDB embedding guidance](https://www.mongodb.com/docs/manual/data-modeling/embedding/)
[MongoDB schema versioning](https://www.mongodb.com/docs/v7.0/tutorial/model-data-for-schema-versioning/)
[PostgreSQL JSON docs](https://www.postgresql.org/docs/current/datatype-json.html)
[PostgreSQL vs MongoDB benchmark](https://www.mdpi.com/2504-2289/10/2/66)
```

baseline call 2 (codex R1): 7 URLs. system-xml call 2: 13 URLs. 동일 모델/라운드/태스크에서 약 2배 — `<grounding>` "Every factual claim must point to specific evidence" 가 codex 의 인용 행동을 강화한 것으로 해석 가능.

### 7.4 반례 — Evidence density 감소 사례 (call 4, haiku R2)

```
**Evidence**: Onboarding cost is empirical. A team without connection-pool knowledge will miss tuning opportunities.
```

→ system-xml haiku R2 (call 4) 는 URL 0 (baseline 9). 본 응답은 메타 비평/구조 중심으로 흘러 link 가 사라짐. 즉 URL 게인은 codex 측에서 발생, haiku 는 감소 — 모델별 반응 차이가 크다.

### 7.5 Steelman 강화 (call 4, haiku R2 vs baseline)

system-xml call 4:
```
**Their Condition 3 (team expertise)** stands if the premise is true.
- If your team shipped MongoDB to production and has zero PostgreSQL ops experience, they *will* move faster with MongoDB in weeks 1–4.
- This is reliable, not speculative.
```

baseline call 4 동일 상대 포지션 처리:
```
**Where the Analyst's Argument Is Underspecified**
```
(상대 입장을 약점 지적 모드로 곧장 진입; "stands if the premise is true" 식의 명시적 condition-conditional steelman 없음).

---

**최종 판단**: 본 2-way 비교 (단일 실행) 에서 system-xml 패치는 effort 인상 없이 콘텐츠 품질을 측정 가능한 수준으로 향상시킨다. 다만 variance 측정 미수행 — 동일 task 3 회 이상 재실행으로 effect-size 확정 필요. 정직한 보고: prompt_tokens 큰 감소는 패치 효과로 귀속하기 어렵다 (codex 캐싱 변동 가능성).
