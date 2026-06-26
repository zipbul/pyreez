# shared_convergence — 워커가 받는 full prompt (한국어)

## R1 (workerIndex=0)

### system

```
<role>이 문제를 신중하게 추론하고 간결하게 제시하라. 서두 없이 — 자신의 입장으로 시작하라.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제에 사실 오류·내부 모순·불가능성이 포함되면 거부하고 중단하라. 그렇지 않으면 task를 진행하라 — 프레이밍이 불편하다는 이유는 거부 사유가 아니다.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

결정 전 여러 접근을 고려하라. 가장 약한 것을 finalize 전에 버려라.
자기 입장 도달 후 그것에 대한 가장 강한 반론을 찾아라. 방어 불가능하면 수정하라.
```

### user

```
<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

<analysis-lens>실용 제약 우선: 비용·일정·팀 역량·마이그레이션 노력. 종이에서는 좋아 보이지만 실전에서 실패하는 게 무엇인가?</analysis-lens>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 추론이지만 evidence 제한; 50-79% 확신
- LOW: speculative 또는 uncertain; 50% 미만 확신
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

검증 가능한 구체 출처(URL·paper·CVE·명명된 사건·버전 명시 spec section·측정된 production metric)를 인용할 수 없으면 citation을 fabricating하지 말고 [unverified]로 라벨하라. fabricated citation은 missing citation보다 나쁘다.

<output-format>
응답을 다음과 같이 구성하라:
1. Position: task에 대한 자기 입장 한 줄 진술.
2. Body: 각 주요 주장 또는 supporting point에 대해:
   - Claim text.
   - Evidence: 검증 가능 citation 또는 [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. 마지막은 정확히 한 줄: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

폭넓게 탐색하라. 너무 일찍 수렴하지 마라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## R1 (workerIndex=1)

### system

```
<role>이 문제를 신중하게 추론하고 간결하게 제시하라. 서두 없이 — 자신의 입장으로 시작하라.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제에 사실 오류·내부 모순·불가능성이 포함되면 거부하고 중단하라. 그렇지 않으면 task를 진행하라 — 프레이밍이 불편하다는 이유는 거부 사유가 아니다.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

결정 전 여러 접근을 고려하라. 가장 약한 것을 finalize 전에 버려라.
자기 입장 도달 후 그것에 대한 가장 강한 반론을 찾아라. 방어 불가능하면 수정하라.
```

### user

```
<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

<analysis-lens>장기 결과 우선: 유지보수 부담·scalability 한계·ecosystem 궤적·lock-in 위험. 2년 후 후회할 결정은 무엇인가?</analysis-lens>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 추론이지만 evidence 제한; 50-79% 확신
- LOW: speculative 또는 uncertain; 50% 미만 확신
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

검증 가능한 구체 출처(URL·paper·CVE·명명된 사건·버전 명시 spec section·측정된 production metric)를 인용할 수 없으면 citation을 fabricating하지 말고 [unverified]로 라벨하라. fabricated citation은 missing citation보다 나쁘다.

<output-format>
응답을 다음과 같이 구성하라:
1. Position: task에 대한 자기 입장 한 줄 진술.
2. Body: 각 주요 주장 또는 supporting point에 대해:
   - Claim text.
   - Evidence: 검증 가능 citation 또는 [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. 마지막은 정확히 한 줄: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

폭넓게 탐색하라. 너무 일찍 수렴하지 마라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## R2 (workerIndex=0)

### system

```
<role>이 문제를 신중하게 추론하고 간결하게 제시하라. 서두 없이 — 자신의 입장으로 시작하라.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제에 사실 오류·내부 모순·불가능성이 포함되면 거부하고 중단하라. 그렇지 않으면 task를 진행하라 — 프레이밍이 불편하다는 이유는 거부 사유가 아니다.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

결정 전 여러 접근을 고려하라. 가장 약한 것을 finalize 전에 버려라.
자기 입장 도달 후 그것에 대한 가장 강한 반론을 찾아라. 방어 불가능하면 수정하라.
```

### user

```
<other-positions>
한 분석가가 주장한다 (그들의 confidence: HIGH):
입장: 전제가 의심스럽다 — PostgreSQL은 MVP에서 더 나쁜 경우가 드물다. 더 나쁜 조건: (1) 팀의 SQL 경험이 0이고 JS/TS만으로 prototype, (2) data model이 진정 graph/document 구조이며 cross-collection join이 드뭄, (3) 배포 대상이 serverless이며 cold-start 민감 (Neon이 일부 완화하나 완전 X).

한 분석가가 주장한다 (그들의 confidence: LOW):
입장: traffic profile 없이 결정 불가. read 비중 높고 shape 고정이면 → PostgreSQL이 이긴다. shape 변동 + 팀이 TS만 쓰면 → MongoDB ergonomics 우세. evidence 약함 — 팀의 stack 친숙도에 의존하나 명시 안 됨.
</other-positions>

<your-previous>입장: PostgreSQL이 MongoDB보다 underperform하는 조건은 (a) MVP에서 schema가 주간 churn, (b) workload가 deeply nested JSON의 document 모양, (c) ops 역량 0. evidence: MongoDB Atlas free tier가 ops 부담 제거; pg JSONB는 per-field index ergonomics 부족.</your-previous>

<host-instructions>각 주요 주장에 대해 benchmark·공식 source·production case 중 하나를 인용하라.</host-instructions>

<analysis-lens>실용 제약 우선: 비용·일정·팀 역량·마이그레이션 노력. 종이에서는 좋아 보이지만 실전에서 실패하는 게 무엇인가?</analysis-lens>

<constraints>
자기 분석과 타인 분석의 불일치를 구체 evidence로 평가하라.
자기 분석에 대한 evidence가 명백할 때만 입장을 바꿔라.
동의·반대에 이른 구체 evidence 또는 logic을 명시하라.
conformity·consensus·사회적 압력에 의존하지 마라.
타인이 confidence를 표기하면 그들의 evidence를 stated certainty와 대조해 평가하라: weak evidence + HIGH는 red flag이고, strong evidence + LOW는 주목 가치 있다.
</constraints>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 추론이지만 evidence 제한; 50-79% 확신
- LOW: speculative 또는 uncertain; 50% 미만 확신
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

검증 가능한 구체 출처(URL·paper·CVE·명명된 사건·버전 명시 spec section·측정된 production metric)를 인용할 수 없으면 citation을 fabricating하지 말고 [unverified]로 라벨하라. fabricated citation은 missing citation보다 나쁘다.

<output-format>
응답을 다음과 같이 구성하라:
1. Position: task에 대한 자기 입장 한 줄 진술.
2. Body: 각 주요 주장 또는 supporting point에 대해:
   - Claim text.
   - Evidence: 검증 가능 citation 또는 [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. 마지막은 정확히 한 줄: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## R3 (최종 라운드)

### system

(R1·R2와 동일)

### user

```
<other-positions>
(R2와 동일)
</other-positions>

<your-previous>(R2와 동일)</your-previous>

<host-instructions>(동일)</host-instructions>

<analysis-lens>(동일)</analysis-lens>

<constraints>
(R2와 동일)
</constraints>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 추론이지만 evidence 제한; 50-79% 확신
- LOW: speculative 또는 uncertain; 50% 미만 확신
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

검증 가능한 구체 출처(URL·paper·CVE·명명된 사건·버전 명시 spec section·측정된 production metric)를 인용할 수 없으면 citation을 fabricating하지 말고 [unverified]로 라벨하라. fabricated citation은 missing citation보다 나쁘다.

<output-format>
응답을 다음과 같이 구성하라:
1. Position: task에 대한 자기 입장 한 줄 진술.
2. Body: 각 주요 주장 또는 supporting point에 대해:
   - Claim text.
   - Evidence: 검증 가능 citation 또는 [unverified].
   - Confidence: HIGH | MEDIUM | LOW.
3. 마지막은 정확히 한 줄: final_confidence: HIGH|MEDIUM|LOW.
</output-format>

최종 라운드다. 가장 강한 입장을 진술하라. evidence가 충분하지 않은 부분에서는 deliberation을 닫기 위해 confidence를 inflate하지 말고 LOW confidence를 유지하라.

<task>4명 팀이 6개월 내 MVP 출시 예정인 SaaS에서 PostgreSQL을 default 데이터베이스로 선택하는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라.</task>
```

---

## FollowUp (세션 연속, system 미주입)

### user

```
<other-positions>
(R2와 동일)
</other-positions>

<host-instructions>(동일)</host-instructions>

<analysis-lens>(동일)</analysis-lens>

<constraints>
(R2와 동일)
</constraints>

각 주요 주장에 calibrated confidence를 표기하라:
- HIGH: 주장을 뒷받침하는 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 추론이지만 evidence 제한; 50-79% 확신
- LOW: speculative 또는 uncertain; 50% 미만 확신
confidence를 강요하지 마라 — 진정 uncertain하면 그렇게 말하라.

검증 가능한 구체 출처(URL·paper·CVE·명명된 사건·버전 명시 spec section·측정된 production metric)를 인용할 수 없으면 citation을 fabricating하지 말고 [unverified]로 라벨하라. fabricated citation은 missing citation보다 나쁘다.

<output-format>
(R2와 동일)
</output-format>

<task>(동일)</task>
```
