# shared_convergence

여러 모델이 독립 분석 → 서로의 입장 보고 재평가 → 라운드 반복으로 수렴된 단일 입장 도달. heterogeneous 풀의 다양성으로 단일 모델 blind spot 보완.

---

## When to use
- valid path가 여럿인 architecture/design 결정
- 트레이드오프 평가 (X vs Y)
- 단일 모델 blind spot이 비싼 판단성 task

## When to skip
- factual lookup, 단일 강모델 + self-consistency로 동등 품질 가능 → 단일 모델
- 단순 코드 생성 → 단일 모델
- weakness 발굴 → `adversarial_debate`
- 점수 매기기 → `evaluation_scoring`
- 점진 개선 → `sequential_refinement`

---

## Task 작성 룰

pyreez가 harness(role·depth·anti-conformity·confidence·lens) 자동 주입. task는 워커가 정확히 **무엇을, 어떤 조건에서, 어떤 형식으로, 어떤 stake로 답해야 하는지**만 전달.

### 1. Failure-condition framing

| Avoid | Use |
|---|---|
| "X가 좋은가?" | "X가 실패하는 구체 조건 N가지" |
| "X와 Y 중 무엇이 낫나?" | "Y보다 X가 나쁜 결과를 내는 조건은?" |
| "X를 도입해야 하나?" | "X 도입이 도입 안 하는 것보다 나쁜 조건은?" |
| "X의 가치는?" | "X가 가치를 잃는 경계 조건은?" |

### 2. 구체 제약 + context
추상 task → 추상 답. 가능한 것 명시:

- **도메인** (환경/스택/언어), **스케일** (사용자/요청/데이터), **시간 지평** (단·장기), **팀 컨텍스트** (인원/숙련도)
- **Stake** — 이 결정이 잘못되면 무엇이 깨지나 (예: "잘못된 선택 시 6개월 마이그레이션 비용", "SLA 위반 시 계약 패널티"). 워커가 stake에 맞는 깊이로 답함
- **이미 검토한 것 / out-of-scope** — "PostgreSQL은 이미 결정. MongoDB만 평가하라" 또는 "비용 분석은 답에 포함 마라"

### 3. Verifiable 출력 형식
binary 검증 가능한 명령으로 박는다.

좋은 예: "조건을 정확히 3개 제시", "각 항목을 한 문단으로", "마지막 줄에 추천 경로 한 문장으로"
나쁜 예: "충분히 자세히 설명하라"

### 4. Lazy-agent 사전 차단
task `<output-format>` 안에 박는다:
> "각 응답은 다른 워커 입장에 대한 구체 critique를 최소 한 개 포함하라. 동의만으로는 불충분."

여러 deliberation에 같은 요구가 반복되면 `--worker-instructions`로 옮긴다 (한 곳에 두 번 박지 마).

### 5. False-premise 거부 + Misleader 방어 (high-stakes)
의료·법률·금융처럼 misleader·잘못된 전제 위험 task에 task 안에 박는다:
> "전제 중 사실이 아니거나 증명 불가, 숨은 가정이 있으면 답변 전에 식별·거부하라."
> "각 주요 주장에 외부 evidence(benchmark·official source·production case) 한 개 인용 필수."

### 6. Few-shot + negative example (복합 출력 시)
복합 출력 형식이면 task 안에 `<example>`(positive 1-2개) / `<bad-example>`(negative 1개) 태그로 박는다.
- positive: 원하는 형식·깊이
- negative: 흔한 오답 패턴 차단 (예: "이 답은 일반론으로 빠짐 — 본 컨텍스트 한정해야 함")

단순 출력에는 불필요.

### 7. 자동주입과 중복 금지
워커에 이미 들어가 있어 또 박지 마:
- HIGH/MED/LOW 표기 / "consensus 의존 마라" / "evidence ground" / "검증하라" / "여러 접근 고려" / "강한 반론" / "no preamble"
- "think step by step" / "reason carefully" / "let's think this through"
- persona ("you are X"), pyreez 자동 부여 lens(분석 차원)
- "be objective" (misleader에 무효 — §5 evidence citation 강제 사용)

---

## Task 길이와 구조

| 길이 | 형식 |
|---|---|
| ~50-150자 | plain text 한 문단 |
| ~150-400자 | XML 구조 권장 |
| >400자 | XML 필수 — 핵심을 시작·끝에 반복 (lost-in-the-middle) |

---

## Pre-flight checklist (invoke 전)

- [ ] failure-condition framing? (directional 아님)
- [ ] 도메인·스케일·시간 지평 명시?
- [ ] Stake 명시 (이 결정이 잘못되면 무엇이 깨지는가)?
- [ ] 이미 검토한 것 / out-of-scope 명시?
- [ ] 출력 형식이 verifiable? (항목 수, 구조)
- [ ] 1인칭 표현 ("I think...") 없음?
- [ ] persona 부여 ("you are X") 없음?
- [ ] 자동주입 중복 ("be objective", "indicate confidence") 없음?
- [ ] secrets/internal paths 마스킹?
- [ ] >150자면 XML 구조?
- [ ] 복합 출력이면 positive + negative example 각 1개? (옵션마다 동일 구조 반복 출력이면 negative만으로 충분)

---

## Examples

### Bad
> "Microservices 좋은가요? I think it might be good. Be objective."

→ directional, 1인칭, 자동주입 중복.

### Good — 단순
> "Bun 1.3 백엔드(DAU 10만)가 Node.js LTS보다 운영상 나쁜 결과를 내는 구체 조건 3가지. 각 조건마다 (a) 사전 신호 (b) 회피 방법을 한 문단."

### Good — 트레이드오프 평가 (XML)
```
<context>
신규 SaaS, MVP 단계, 4명 풀스택 팀, 6개월 내 출시 목표.
</context>

<question>
PostgreSQL을 default DB로 쓰는 것이 MongoDB보다 나쁜 결과를 내는 구체 조건 3가지를 식별하라. 일반론 아닌 본 컨텍스트 기준.
</question>

<output-format>
조건마다:
- 조건 설명 + 어떤 기능/스케일에서 발현되는지 (한 문단)
- PostgreSQL 한정 회피책 또는 MongoDB가 더 나은 경계 (한 문단)
마지막 줄: "PostgreSQL 권장" 또는 "MongoDB 권장" 한 문장.
</output-format>
```

### Good — 복합 도입 결정 (XML, 모든 기법 포함)
```
<context>
50인 엔지니어 팀, 5년차 Ruby on Rails monolith.
일일 트랜잭션 200만, P95 latency 400ms.
</context>

<stake>
잘못된 결정 시 12-18개월 마이그레이션 인력 비용 + 기능 출시 정체.
</stake>

<already-considered>
- 모듈화 monolith (modular monolith) — 이미 결정에서 제외됨
- 단계적 strangler pattern — 본 결정에 포함되어 있음
</already-considered>

<question>
Rails monolith → microservices 마이그레이션 자체가 6개월~2년 시점에서 monolith 유지보다 나쁜 결과를 내는 조건 3가지를 식별하라.
</question>

<output-format>
조건마다:
- 조건 설명 + 사전 식별 가능한 기술/조직 신호 (한 문단)
- 회피 또는 완화 방법 (한 문단)
</output-format>

<bad-example>
"팀 사이즈가 작으면 microservices가 어렵다" — 일반론으로 빠짐. 본 컨텍스트(50인) 기준 구체 메커니즘이어야 함.
</bad-example>

<out-of-scope>
- 비용 정량 추정 (별도 분석 진행 중)
- 특정 vendor (k8s, AWS) 추천
</out-of-scope>

<premise-check>
위 전제(인원·트래픽·latency)에 명백한 모순이 있으면 답변 전 지적.
</premise-check>
```

---

## `--worker-instructions`

전 워커 동일 추가 지시. task와 별도 필요할 때만.

**Use**
- 도메인 framing — "Treat as a Bun runtime architecture choice"
- 출력 추가 제약 — "End with one recommended path in a single sentence"
- Evidence citation 강제 — "Cite a benchmark, source, or production case for each major claim"
- Surface dissent — "If your analysis diverges from the emerging consensus, state your dissent and the specific evidence"
- Substantive critique — "Each response must include at least one specific critique of another worker's position"

**Skip**
- 자동주입 중복
- persona
- 워커 lens와 충돌하는 강한 관점 — "비용 무시하라"는 "실용 제약" lens 워커와 모순. lens-agnostic하게

---

## Models / parameters

### `--models`
- `bun run src/cli.ts models`로 가용 확인
- ≥3 distinct provider 권장 (같은 family >50%면 가치 약화)

### `--max-rounds`
| 값 | 사용 |
|---|---|
| **3** | default. lens 활성, round 2에서 수렴 시 조기 종료 가능 |
| 4-5 | contested topic, budget 여유 |
| 2 | **금지** — 조기 종료 작동 안 함, 비용 절약 0 |
| 1 | **금지** — lens·anti-conformity·조기 종료 모두 비활성 |

### `--count`
- default = model 수, hard cap 7
- ≥4면 inspect에서 ranking 추가

### `--factual true` (선택)
verifiable factual claim이 포함된 task면 inspect에 quality 검증 추가. 의견·설계·예측은 false 유지.

---

## Read output

### `convergence.level`
| level | 행동 |
|---|---|
| `high` | 응답 직접 read해 evidence quality 확인. heterogeneous에서는 contested topic도 자연 high — high 자체는 sycophancy 신호 X. **HIGH의 결정적 주장은 외부 도구나 다른 모델로 cross-check** |
| `moderate` + dissenter | dissenter 응답 **먼저** read. 소수 의견이 결과 뒤집는 경우 많음. **단 두 함정 검증**: (a) judge가 stale round로 라벨하는 경우 — final round에서 dissenter가 입장 변경했는지 직접 확인 (b) dissenter가 라운드마다 입장 flip(최종 추천 옵션이 round 사이 변경)하면 incoherent — discount하고 다수 합의로 진행. prior error 정정(같은 옵션 유지 + 근거 보완)은 flip 아님 |
| `moderate` no dissenter | split 명시하며 합성 |
| `diverse` | (a) 보완적 framing — 다양성 보존하며 합성 (b) 기본 사실 불일치 — task underspec, 재구성 |
| `unknown` | 응답 직접 read |
| `insufficient` | <2 응답 — worker 추가 재실행 |

### `confidence`
HIGH/MEDIUM/LOW 자동 파싱 (한국어 `신뢰도:` 포함). 동률 시 보수적인 것. evidence 약한 HIGH는 red flag — 응답 직접 read해 검증.

### `host_actions`
- `provider_diversity_low` — caveat, 가능 시 broader pool 재실행
- `self_judge_bias` — 다른 provider judge로 inspect 재실행. 가용 provider가 모두 worker pool에 있어 회피 불가능 시 두 cross-provider judge 결과(level + ranking) 일치하면 bias 상쇄로 간주, 진행
- `convergence is HIGH — reframe task as failure-conditions question` — judge가 task 형태를 검사 안 하고 항상 emit한다. **task가 이미 failure-condition framing이면 무시**. 그 경우 HIGH 자체 해석은 위 `convergence.level: high` 행만 적용

### `convergenceScore`
`level`과 mismatch (예: `level: high`, `status: diverging`)면 응답 직접 read.
`components.evidence: 0`인데 응답에 URL·official source·production case 다수 인용되면 형식 mismatch — 응답 직접 read 우선.

---

## Synthesis (shared-convergence 한정)

high convergence:
- 공통된 핵심 입장을 backbone으로
- 각 워커의 unique nuance·예시·caveat 누적 (잃지 마)
- HIGH-confidence 결정적 주장은 외부 검증 후 채택

moderate/diverse: SKILL.md `Synthesize` 섹션의 generic 패턴 (unique_contribution / loss_if_removed / gap check) 적용.

**Acceptance skip 조건** (호스트 판단, default skip):
- 사용자가 결정·추천·단일 답만 요청, 합성문 ratify를 명시 안 함
- 다수 워커 강한 수렴 + 잔여 dissenter가 incoherent (라운드별 flip)
- acceptance 추가 비용이 결론 자체를 바꿀 가능성 없음

위 조건 미해당 시 acceptance 실행. 1-3회 cap.

---

## Re-run / abort / iterate

**Re-run**
- HIGH but 모든 워커가 evidence 없이 같은 reasoning echo → 거짓 합의
- 한 워커 응답을 다른 워커가 그대로 echo → lazy agent
- `self_judge_bias` → 다른 provider judge
- `degradation` + 가용 pool 남음

**Iterate task wording**
첫 run의 워커 응답이 원하는 방향과 멀면 재실행 전 task 재작성. 흔한 원인:
- 제약이 약해서 워커들이 다른 차원을 답함 → 도메인·스케일 추가
- 출력 형식이 모호해 응답 형태가 비교 불가 → verifiable 명령으로
- directional 잔여 → failure-condition 강화

**Abort (사용자 escalate)**
- 2회 재실행에도 HIGH on contested 지속 → task 재구성 요청
- ≥3 provider 미달
- **`<premise-check>`에 워커 다수가 task 전제(부하·인원·SLA·timeline 등 숫자/사실)를 거부**: synthesis 진행 금지. 거부된 전제를 사용자에게 보고하고 task 수정 요청. 거짓 전제 위에서 합성하면 결론 자체가 무효

---

## Edge cases

| 상황 | deliberate 출력 | 행동 |
|---|---|---|
| 모든 워커 fail | `failedWorkers` ≥ 요청 수, `responses.length: 0` | 사용자에게 즉시 보고 (provider outage 또는 task가 모든 모델 reject 트리거 — 후자는 false-premise 의심) |
| `degradation` 다수 (active < min_viable) | engine이 `TeamDegradedError` throw | 가용 모델 풀 검토 후 narrower pool로 재실행. 동일 에러 재발 시 사용자 escalate |
| `cooldown` 폭주 (다수 모델 cooldown으로 풀 고갈) | 새 deliberate 호출 시 fallback chain 짧아져 즉시 fail 또는 단일 provider만 남음 | provider auth/quota 점검. 일시적이면 시간 두고 재실행, 반복되면 사용자 escalate |
| `modelSwaps` 발생 | `modelSwaps` array에 swap 기록 | (a) task에 vendor policy 명시 + 위반 시 결과 폐기, narrower `--models` 풀로 재실행 (b) policy 미명시면 swap 진행 가능. 단 swap으로 같은 family가 워커 풀의 >50% 차지하면 broader pool로 re-run (c) swap이 same-provider 약모델 fallback(예: pro→flash)이면 결과 신뢰도 약화 caveat 명시, 가능 시 broader pool로 re-run |
| 결과 JSON에 `convergence`·`convergenceScore` 없음 (inspect 미실행) | deliberate만 호출됨 | inspect 호출 누락 — pipe해서 재해석. SKILL.md workflow 5단계 |
