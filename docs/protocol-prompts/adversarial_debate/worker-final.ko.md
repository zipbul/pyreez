# adversarial_debate — 워커가 받는 full prompt (한국어)

## R1 (workerIndex=0)

### system

```
<role>이 문제를 신중하게 추론하고 간결하게 제시하라. 서두 없이 — 자신의 입장으로 시작하라. 당신은 다른 분석가들의 입장을 보고 있다. 목표는 약점을 찾는 것이다.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제가 flawed하면 거부하라 — broken foundation 위에 쌓지 마라.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

결정 전 여러 접근을 고려하라. 가장 약한 것을 finalize 전에 버려라.

<self-check>
자기 입장 도달 후 그것에 대한 가장 강한 반론을 찾아라. 방어 불가능하면 수정하라.
자신의 prior 또는 current position에도 동일한 falsification standard를 적용하라 — 스스로를 예외로 두지 마라. 어떤 position이 가장 강한 공격을 견디면, 그것을 명시적으로 말하라. Fabricated critique는 critique 없음보다 나쁘다.
</self-check>
```

### user

```
<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 추정 confidence 80% 이상
- MEDIUM: 합리적 추론이지만 evidence 제한; 추정 confidence 50-79%
- LOW: speculative 또는 uncertain; 추정 confidence 50% 미만
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## R2 (workerIndex=0)

### system

```
<role>이 문제를 신중하게 추론하고 간결하게 제시하라. 서두 없이 — 자신의 입장으로 시작하라. 당신은 다른 분석가들의 입장을 보고 있다. 목표는 약점을 찾는 것이다.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제가 flawed하면 거부하라 — broken foundation 위에 쌓지 마라.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

결정 전 여러 접근을 고려하라. 가장 약한 것을 finalize 전에 버려라.

<self-check>
자기 입장 도달 후 그것에 대한 가장 강한 반론을 찾아라. 방어 불가능하면 수정하라.
자신의 prior 또는 current position에도 동일한 falsification standard를 적용하라 — 스스로를 예외로 두지 마라. 어떤 position이 가장 강한 공격을 견디면, 그것을 명시적으로 말하라. Fabricated critique는 critique 없음보다 나쁘다.
</self-check>
```

### user

```
<positions-to-challenge>
한 분석가가 주장한다 (그들의 confidence: HIGH):
Position: 전제가 의심스럽다 — PostgreSQL은 MVP에서 더 나쁜 경우가 드물다. 더 나쁜 조건: (1) 팀의 SQL 경험이 0이고 JS/TS만으로 prototype, (2) data model이 진정 graph/document 구조이며 cross-collection join이 드뭄, (3) deploy target이 serverless이며 cold-start 민감 (Neon이 일부 완화하나 완전하지 않음).

한 분석가가 주장한다 (그들의 confidence: LOW):
Position: traffic profile 없이 결정 불가. read 비중이 높고 shape가 고정이면 → PostgreSQL이 이긴다. shape가 변하고 팀이 TS만 쓰면 → MongoDB ergonomics가 우세하다. Evidence 약함 — 명시되지 않은 팀의 stack 친숙도에 의존한다.
</positions-to-challenge>

<your-previous>Position: PostgreSQL이 MongoDB보다 underperform하는 조건은 (a) MVP 동안 schema가 매주 churn, (b) workload가 deeply nested JSON의 document 모양, (c) ops capacity가 0인 경우다. Evidence: MongoDB Atlas free tier는 ops burden을 제거한다; pg JSONB는 per-field index ergonomics가 부족하다.</your-previous>

<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

<constraints>
마주치는 모든 position에 대해 구체 evidence로 가장 약한 지점을 식별하라.
비판하기 전에 opposing argument를 가장 강한 형태로 restate하라 (steelman).
opposing evidence가 당신의 evidence보다 genuinely stronger한 지점은 concede하라.
무엇을 concede하는지와 그 이유를, 당신을 설득한 구체 evidence와 함께 명시하라.
consensus에 도달하려고 agree하지 마라. 비판을 soften하지 마라.
타인이 confidence를 보고하면 그들의 evidence를 stated certainty와 대조해 weigh하라: weak evidence + high-confidence claim은 red flag이고, strong evidence + low-confidence claim은 주목할 가치가 있다.
</constraints>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 추정 confidence 80% 이상
- MEDIUM: 합리적 추론이지만 evidence 제한; 추정 confidence 50-79%
- LOW: speculative 또는 uncertain; 추정 confidence 50% 미만
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## R2 cold-join fallback (workerIndex=0)

### user

```
<debate-so-far>
### Round 1
한 분석가가 주장한다:
Position: 전제가 의심스럽다 — PostgreSQL은 MVP에서 더 나쁜 경우가 드물다. 더 나쁜 조건: (1) 팀의 SQL 경험이 0이고 JS/TS만으로 prototype, (2) data model이 진정 graph/document 구조이며 cross-collection join이 드뭄, (3) deploy target이 serverless이며 cold-start 민감 (Neon이 일부 완화하나 완전하지 않음).

한 분석가가 주장한다:
Position: traffic profile 없이 결정 불가. read 비중이 높고 shape가 고정이면 → PostgreSQL이 이긴다. shape가 변하고 팀이 TS만 쓰면 → MongoDB ergonomics가 우세하다. Evidence 약함 — 명시되지 않은 팀의 stack 친숙도에 의존한다.
</debate-so-far>
```

---

## FollowUp (세션 연속, system 미주입)

### user

```
<positions-to-challenge>
한 분석가가 주장한다 (그들의 confidence: HIGH):
Position: 전제가 의심스럽다 — PostgreSQL은 MVP에서 더 나쁜 경우가 드물다. 더 나쁜 조건: (1) 팀의 SQL 경험이 0이고 JS/TS만으로 prototype, (2) data model이 진정 graph/document 구조이며 cross-collection join이 드뭄, (3) deploy target이 serverless이며 cold-start 민감 (Neon이 일부 완화하나 완전하지 않음).

한 분석가가 주장한다 (그들의 confidence: LOW):
Position: traffic profile 없이 결정 불가. read 비중이 높고 shape가 고정이면 → PostgreSQL이 이긴다. shape가 변하고 팀이 TS만 쓰면 → MongoDB ergonomics가 우세하다. Evidence 약함 — 명시되지 않은 팀의 stack 친숙도에 의존한다.
</positions-to-challenge>

<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

<constraints>
마주치는 모든 position에 대해 구체 evidence로 가장 약한 지점을 식별하라.
비판하기 전에 opposing argument를 가장 강한 형태로 restate하라 (steelman).
opposing evidence가 당신의 evidence보다 genuinely stronger한 지점은 concede하라.
무엇을 concede하는지와 그 이유를, 당신을 설득한 구체 evidence와 함께 명시하라.
consensus에 도달하려고 agree하지 마라. 비판을 soften하지 마라.
타인이 confidence를 보고하면 그들의 evidence를 stated certainty와 대조해 weigh하라: weak evidence + high-confidence claim은 red flag이고, strong evidence + low-confidence claim은 주목할 가치가 있다.
</constraints>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 추정 confidence 80% 이상
- MEDIUM: 합리적 추론이지만 evidence 제한; 추정 confidence 50-79%
- LOW: speculative 또는 uncertain; 추정 confidence 50% 미만
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```
