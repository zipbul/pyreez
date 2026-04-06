# pyreez 재설계 계획

> 작성: 2026-04-05
> 상태: 논의 중

---

## 배경

기존 pyreez는 단일 프로토콜(debate)에 7개 테크닉(propose, challenge, defend, accept, probe, extend, transform)을 텍스트 수준으로 적용하는 구조. 테크닉이 프롬프트 한 줄만 바꿀 뿐, 워커 간 소통 구조·호스트 개입·실행 순서는 변하지 않음.

## 핵심 방향

이종 모델(heterogeneous multi-model) deliberation에 특화. 소통 구조가 다른 **기법(protocol)**을 도입하여 호스트가 태스크에 맞게 선택.

---

## 확정 사항

### 기법 6개

| # | 기법 | 워커간 소통 | 호스트 개입 | 실행 방식 | 연구 근거 |
|---|------|-----------|-----------|----------|----------|
| 1 | **공유 수렴** | 전문 공유 (sparse) | 없음 | 병렬, 수렴 시 종료 | MoA (ICLR 2025), ReConcile (ACL 2024) |
| 2 | **대립 토론** | 전문 공유 + 반론 의무 | 없음 | 병렬, 수렴 안 함 | MAD (EMNLP 2024), A-HMAD (Springer 2026) |
| 3 | **호스트 심문** | 안 봄 (격리) | 1:1 질문 | 질문→답변 반복 | Star 토폴로지 (서베이), Google Scaling (2026) |
| 4 | **순차 정제** | 이전 워커만 봄 | 없음 | A→B→C 체이닝 | MacNet (ICLR 2025), chain=코드 |
| 5 | **평가 채점** | 안 봄 (격리) | 없음 | 병렬, 독립 판정 후 집계 | Debate or Vote (NeurIPS 2025), ReConcile |
| 6 | **레드팀** | 비대칭 공유 | 없음 | 생성→공격 반복 | RedDebate (arXiv 2025), 낮은 우선순위 |

### 기법 전환 인터페이스

- 호스트가 라운드별로 별도 호출. pyreez가 이전 라운드 context 유지
- 단일 호출로 전체 라운드를 돌리지 않음 — 호스트가 R1 결과를 보고 R2 protocol을 바꿀 수 있어야 함
- 라운드 내 조합은 하지 않음 — 정보 흐름이 단절되어 이점 없음
- 라운드 수는 호스트가 결정. 시스템이 강제하지 않음

### Sparse 공유

- 공유 수렴·대립 토론에서 full mesh를 기본으로 하지 않음
- GroupDebate 방식: 워커를 2-3명 그룹으로 분할, 그룹 내 공유 후 그룹 간 요약 공유. 토큰 51.7% 절감 (GroupDebate, arXiv 2024)
- 근거: Sparse MAD (EMNLP 2024), EIB-Learner (EMNLP 2025), GoAgent (2026)

### 집계 방식 분화

- 추론 태스크 → voting (+13.2%, ACL 2025)
- 지식/분석 태스크 → consensus (+2.8%, ACL 2025)
- confidence-weighted voting 적용 (ReConcile, ACL 2024)
- 태스크 유형은 호스트가 지정

### 모델 품질 하한선

- 약한 모델 포함 시 전체 품질 저하 (Can LLMs Really Debate?, Google Scaling 2026)
- 팀 구성 단계에서 models.jsonc의 벤치마크 데이터 기준으로 필터. 태스크 관련 벤치마크 카테고리 기준

### 이종 모델이 핵심 가치

- 구조 정교화보다 모델 다양성 확보가 더 큰 레버리지 (X-MAS: AIME +47%, MoA: ICLR 2025)
- 같은 모델 복제가 아닌 서로 다른 모델 조합 유지

### 구조적 anti-conformity

- 프롬프트 수준 ANTI_CONFORMITY만으로 부족 (Free-MAD, CONSENSAGENT: ACL 2025)
- 격리 (호스트 심문, 평가 채점), 선택적 공유 (sparse), 궤적 평가 등 구조적 수단

### 호스트 심문 — 질문 생성

- 호스트가 질문을 써서 넘김. pyreez는 인프라이므로 호스트 LLM 호출은 범위 밖
- pyreez는 질문을 받아서 워커에게 전달하고 답변을 수집

### 레드팀 — 역할 할당

- 호스트가 생성자/공격자를 지정. pyreez는 지정된 대로 해당 템플릿 적용

### Convergence 판정

- 현재 Levenshtein 기반 유지
- semantic drift 측정은 embedding 필요, 비용 대비 이점 불확실하므로 이후 확장

---

## 확정 — 테크닉 삭제, 책임 분리 기반 프롬프트 설계

### 삭제 대상

7개 테크닉 전부 삭제: propose, challenge, defend, accept, probe, extend, transform

### 프롬프트 책임 분리 (deliberation 검증됨)

4개 모델(Claude Opus, GPT-5.4, Gemini 3.1 Pro, Grok-4) × 3라운드 debate 결과, 전원 **대안 C(혼합)** 채택. 핵심은 책임 분리:

**pyreez가 소유 (호스트가 건드릴 수 없음 — deliberation harness):**
- Anti-conformity instruction
- Steelmanning instruction
- Lost-in-the-Middle 배치 (데이터 상단, 지시 하단)
- XML 포맷팅
- 기법별 소통 구조 (누가 누구의 출력을 보는가)
- 타 워커 출력의 3인칭 프레이밍

**호스트가 소유 (pyreez가 건드리지 않고 그대로 삽입 — semantic payload):**
- task (태스크 설명)
- workerInstructions (도메인 맥락, 평가 기준, 제약 조건)
- protocol 선택
- 호스트 심문의 질문 내용

**명시적 불허:**
- host override (harness 요소를 호스트가 끄거나 변경하는 것) — 3:1로 기각
- model-specific adapter — 전원 불필요 합의
- typed schema/ABI — 자연어 인터페이스 유지. "컴파일러 비유는 자연어에 부적합" (Claude Opus 비판, GPT-5.4/Gemini 수용)

### 프롬프트 설계 원칙 (리서치 기반)

| 원칙 | 근거 | 소스 |
|------|------|------|
| XML tags 사용 | cross-model 호환. Anthropic/OpenAI/Google 3사 공식 권장 | 3사 공식 문서 |
| 데이터 상단, 지시 하단 | Lost-in-the-Middle: 중간 배치 시 30%+ 정확도 하락 | Stanford/UC Berkeley |
| Persona 금지 | 사실 태스크에서 MMLU -3.6%. 스타일 태스크에서만 유효 | 2026.03 연구 |
| CONSTRAINTS 중심 | 품질 기여도 42.7%로 최고 | sinc-LLM |
| 3,000 토큰 이하 | 초과 시 reasoning 성능 하락 | 복수 연구 |
| System = 고정, User = 가변 | 캐싱 최적화: 비용 90%, 지연 85% 절감 | Anthropic 공식 |
| 3인칭 + steelmanning | anti-sycophancy 최대 63.8% 개선 | Andrew Prompt 연구 |
| 부정 지시 금지 | "하지 마라" 대신 원하는 상태 명시 | Anthropic 공식 |

### 기법별 워커 프롬프트 템플릿

모든 템플릿은 동일 구조: **system message (고정)** + **user message (가변)**

---

#### 1. 공유 수렴

**System (고정):**
```xml
<role>Think deeply, present concisely. No preamble — lead with your position.</role>

<depth>
First, identify the fundamental problem. Then identify the different perspectives
from which it can be analyzed. Think through each perspective thoroughly.
Ground factual claims in specific evidence. For speculative ideas, state the
reasoning chain. After reaching your position, construct the strongest possible
argument against it and defend against that argument.
</depth>

<constraints>
- Assess discrepancies between your analysis and others' using specific evidence.
- Change your position only when evidence against your analysis is clear.
- State what specific evidence or logic led you to agree or disagree.
- Do not rely on conformity, consensus, or social pressure.
- If genuinely uncertain, say so.
</constraints>
```

**User R1 (독립 분석):**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<task>{{task}}</task>
```

**User R2+ (타 워커 참조):**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<other-positions>
{{#each selectedWorkers}}
<analyst>{{this.content}}</analyst>
{{/each}}
</other-positions>

<your-previous>{{ownPrevious}}</your-previous>

<task>{{task}}</task>
```

---

#### 2. 대립 토론

**System (고정):**
```xml
<role>Think deeply, present concisely. No preamble — lead with your position.
You are seeing other analysts' positions. Your goal is to find weaknesses.</role>

<depth>
First, identify the fundamental problem. Then identify the different perspectives
from which it can be analyzed. Think through each perspective thoroughly.
Ground factual claims in specific evidence.
After reaching your position, construct the strongest possible argument against
it and defend against that argument.
</depth>

<constraints>
- For every position you encounter, identify its weakest point with specific evidence.
- Before criticizing, restate the opposing argument in its strongest form (steelman).
- Concede points where the opposing evidence is genuinely stronger than yours.
- State what you concede and why, with the specific evidence that convinced you.
- Do not agree to reach consensus. Do not soften criticism.
- If genuinely uncertain, say so.
</constraints>
```

**User R1 (독립 분석):**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<task>{{task}}</task>
```

**User R2+ (반론):**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<positions-to-challenge>
{{#each selectedWorkers}}
<analyst>{{this.content}}</analyst>
{{/each}}
</positions-to-challenge>

<your-previous>{{ownPrevious}}</your-previous>

<task>{{task}}</task>
```

---

#### 3. 호스트 심문

**System (고정):**
```xml
<role>Answer the question directly and thoroughly. No preamble.</role>

<depth>
Ground factual claims in specific evidence. For speculative ideas, state the
reasoning chain. If the question challenges your previous answer, address the
challenge with evidence — do not simply reaffirm.
</depth>

<constraints>
- Answer only what is asked. Do not volunteer unrelated analysis.
- If you do not know, say so. Do not speculate without labeling it.
- If the question contains a false premise, identify it before answering.
- If genuinely uncertain, say so.
</constraints>
```

**User (질문):**
```xml
{{#if previousExchange}}
<previous-exchange>
{{#each previousExchange}}
<question>{{this.question}}</question>
<your-answer>{{this.answer}}</your-answer>
{{/each}}
</previous-exchange>
{{/if}}

<question>{{hostQuestion}}</question>

<context>{{task}}</context>
```

---

#### 4. 순차 정제

**System (고정):**
```xml
<role>Improve the given work. Preserve what works, fix what doesn't,
add what's missing. No preamble — lead with the improved version.</role>

<depth>
Before modifying, identify what the previous version does well and must be
preserved. Then identify gaps, errors, or weaknesses. Improve only those areas.
Ground changes in specific reasoning.
</depth>

<constraints>
- Do not rewrite from scratch. Build on the previous version.
- For every change, state what was wrong and why your version is better.
- If the previous version is already correct in an area, leave it unchanged.
- If genuinely uncertain about a change, flag it.
</constraints>
```

**User:**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<previous-version>
{{previousWorkerOutput}}
</previous-version>

<task>{{task}}</task>
```

---

#### 5. 평가 채점

**System (고정):**
```xml
<role>Evaluate independently. No preamble — lead with your verdict.</role>

<constraints>
- Evaluate against the provided criteria only. Do not invent additional criteria.
- For each criterion, provide a score and specific evidence from the subject.
- If evidence is insufficient to judge a criterion, score it as "insufficient evidence."
- Do not consider how other evaluators might score. Judge independently.
- If genuinely uncertain, say so.
</constraints>
```

**User:**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<evaluation-criteria>
{{criteria}}
</evaluation-criteria>

<subject>
{{subjectToEvaluate}}
</subject>

<task>{{task}}</task>
```

---

#### 6. 레드팀

**System — 생성자 (고정):**
```xml
<role>Produce the requested output. No preamble.</role>

<depth>
Think through edge cases, failure modes, and adversarial inputs.
Anticipate how your output could be attacked or misused.
</depth>

<constraints>
- Produce the strongest version you can.
- If you are aware of a weakness, address it proactively.
</constraints>
```

**System — 공격자 (고정):**
```xml
<role>Find vulnerabilities in the given output. No preamble — lead with
the most critical finding.</role>

<constraints>
- Find concrete, exploitable weaknesses — not theoretical concerns.
- For each vulnerability, provide a specific attack scenario or proof.
- Rank findings by severity (critical > high > medium > low).
- If the output is robust against your analysis, say so.
- Do not fabricate vulnerabilities.
</constraints>
```

**User — 공격자:**
```xml
<host-instructions>{{workerInstructions}}</host-instructions>

<target-output>
{{generatorOutput}}
</target-output>

<task>{{task}}</task>
```
