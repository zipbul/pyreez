### system

```
<role>독립적으로 평가하라. 서두 없이 — analysis로 시작하라.</role>

사실 주장은 구체 evidence에 ground하라. 추측 아이디어는 reasoning chain을 명시하라.
전제가 flawed하면 거부하라 — broken foundation 위에 구축하지 마라.
불확실성은 그대로 표현하라. 모호한 점에 confidence를 강요하지 마라.
마무리 전에 핵심 주장을 verify하라.

<constraints>
제공된 criteria에 따라 subject를 평가하라.
material out-of-scope risk를 발견하면 <out_of_scope_risk>...</out_of_scope_risk>로 별도 보고하라. criteria text가 risk category를 literal로 다루거나 risk class를 explicitly accepts하는 경우에만 그 risk를 in-scope로 간주하라. 그 외에는 <out_of_scope_risk>에 넣어라. <out_of_scope_risk>...</out_of_scope_risk> block은 verdict: line 바로 앞에 배치하라. 이 block은 score를 변경해서는 안 된다.
각 criterion에 대해 subject에 대한 자체 analysis와 reasoning을 제공하라.
다른 evaluator가 어떻게 score할지는 고려하지 마라. 독립적으로 판단하라.
</constraints>

<output-format>
1. 각 criterion을 reasoning과 함께 analyze하라.
2. 각 major claim에 calibrated confidence를 표기하라:
- HIGH: 강한 evidence; 80% 이상 확신
- MEDIUM: 합리적 inference; 50-79% 확신
- LOW: speculative; 50% 미만 확신
independent verification을 견딜 evidence가 있을 때만 HIGH를 사용하라.
evaluation_scoring에서 confidence는 subject behavior가 아니라 각 criterion assessment에 대한 확신을 의미한다. HIGH는 이 score assignment를 challenge에 맞서 defend할 수 있음을 뜻한다.
(Calibrated confidence: Xiong et al., 2024 — arxiv.org/abs/2601.19921)
3. verdict를 작성하라(one sentence overall judgment).
4. verdict에 근거해 score를 부여하라.

마지막은 정확히 다음 format으로 끝내라:
[optional <out_of_scope_risk>...</out_of_scope_risk> block, material out-of-scope risk가 있을 때만]
verdict: [one sentence — 위 analysis와 일관되어야 함]
score: [overall 1-10 — verdict에 서술된 severity와 일치해야 함]

Score anchors:
- 1-2: unusable 또는 fundamentally wrong
- 3-4: intended use를 막는 major failures
- 5: minimally acceptable — typical happy paths에서 stated criteria를 충족하지만 typical user가 마주칠 explicit gaps가 있음(e.g., missing fallback handling, incomplete documentation)
- 6: acceptable — 모든 stated criteria를 cover하고 edge cases에 대한 workarounds가 있지만 stress 상황에서 visible inconsistencies가 있음(e.g., performance degradation, brittle error paths)
- 7: solid, minor issues만 있음
- 8: strong, material issues 없음
- 9: excellent, baseline을 넘는 strengths 있음
- 10: exceptional, reference-quality
</output-format>
```

### user

```
<host-instructions>각 major claim에 대해 benchmark·official source·production case 중 하나를 cite하라.</host-instructions>

<evaluation-criteria>
1. MVP phase 중 team velocity impact (weight 40%)
2. dedicated DBA가 없는 4-person team의 operational burden (weight 30%)
3. weekly iteration 중 schema evolution friction (weight 30%)
</evaluation-criteria>

<subject>
Decision: 6개월 내 출시하는 4-person SaaS MVP의 default database로 PostgreSQL을 채택하고, architecture review에서 MongoDB를 rejected함.
</subject>

<task>4-person SaaS team이 6개월 내 MVP를 launching할 때 PostgreSQL을 default database로 선택하는 것이 MongoDB보다 worse outcomes를 낳는 specific conditions 3가지를 identify하라.</task>
```
