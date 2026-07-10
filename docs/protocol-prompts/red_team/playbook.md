# red_team

비대칭 역할 — `generator`가 산출물 생성, `attacker`가 공격. default 2 라운드 (gen → attack → gen 재반영). 보안 robustness·adversarial 검증용.

---

## When to use
- 보안 리뷰 — auth flow, input validation, crypto 사용, injection 방어
- prompt·LLM 출력 robustness — jailbreak·injection 저항
- API endpoint·spec의 misuse 가능성 발굴
- 공격 시나리오 + 방어 강화 한 사이클

## When to skip
- 일반 weakness 발굴 (역할 비대칭 불필요) → `adversarial_debate`
- 점수 → `evaluation_scoring`
- 합의된 입장 → `shared_convergence`
- 점진 개선 → `sequential_refinement`

---

## 입력 구조

| 필드 | 역할 |
|---|---|
| `--task` | 산출물·target 설명 |
| `roles` (API: `Record<workerIndex, "generator"\|"attacker">`) | 역할 분배 |
| `--worker-instructions` | 양 역할 동일 추가 지시 (도메인 framing 등) |

`roles` 미지정 시 기본 분배는 코드 확인 필요 (사용 전 `roles` 명시 권장).

---

## Task 작성 룰

자동 주입:
- **Generator**: depth(global only) + "Think through edge cases, failure modes, adversarial inputs" + "Anticipate how output could be attacked or misused" + "Produce strongest version. Address known weakness proactively"
- **Attacker**: depth(global only) + "Find concrete, consequential weaknesses (attack·misuse·misread·omission) — not theoretical" + "specific scenario or proof showing the harm" + severity ranking(critical>high>medium>low) + "Do not fabricate vulnerabilities" + "If robust, say so"

DEPTH_EXPLORE/REFINE **미주입**. CONFIDENCE fragment **미주입** — attacker는 severity로 신뢰도 표현.

### 1. Target·threat model 명시
공격 대상의 환경·신뢰 boundary 명시:
- "production web API, 인증된 user만 접근, but session token client-side 저장"
- "internal LLM agent, untrusted user input → tool call 가능"
- "open source library, attacker는 모든 코드 read 가능"

threat model 없으면 attacker가 비현실적 공격 fabricate.

### 2. Scope 제한
공격 범위 명시:
- "L7 attack only" / "supply chain 제외"
- "OWASP Top 10 2025 해당 항목만"
- "input validation·auth·session에 한정"

scope 없으면 attacker가 unbounded — 모든 critique를 critical로 표기하는 noise 발생.

### 3. Generator 결과물 형식 강제
`--task`는 generator가 무엇을 출력할지도 정의:
- "TypeScript 함수 + 사용 예시 + 가정 list"
- "API endpoint spec + auth flow + error handling"
- 결과물 형식 모호하면 attacker가 공격할 surface가 불분명

### 4. Severity 기준 명시
자동 주입의 severity (critical/high/medium/low) 외 도메인 정의 추가 가능:
- "critical = pre-auth RCE / data exfil 가능, high = auth 우회, medium = info disclosure, low = best practice deviation"

### 5. False positive 차단
attacker 자동 주입에 "Do not fabricate" 있으나 보강:
> "각 attack은 (a) 실행 가능 시나리오 (b) 영향 범위 (c) PoC 또는 spec·CVE·case 인용. 인용 불가능하면 제외."

### 6. 자동주입 중복 금지
- generator: "produce strongest version", "anticipate attacks", "edge case"
- attacker: "find weakness", "concrete consequential (attack·misuse·misread·omission)", "severity ranking", "do not fabricate"
- 양쪽: "no preamble", premise reject

---

## Pre-flight checklist

- [ ] threat model·scope 명시?
- [ ] generator 출력 형식 정의?
- [ ] severity 기준 도메인-구체화?
- [ ] PoC·CVE·spec 인용 강제?
- [ ] models ≥2 (engine 강제)?
- [ ] `roles` 명시 (기본 분배 의존 회피)?
- [ ] secrets·실제 prod credential 마스킹? (특히 attacker가 실제 시도 안내 가능성 — 안전 inputs only)

---

## Examples

### Bad
> "이 API 보안 검토해."

→ threat model 없음, scope 없음, 형식 없음 → attacker가 fabricate 가능.

### Good — auth flow red team
```
<context>
Production SaaS, JWT 기반 auth. token client-side localStorage 저장.
threat model: external attacker (network·browser 접근), authenticated insider, supply chain 제외.
scope: OWASP Top 10 2025 + JWT-specific (RFC 8725) 위반.
</context>

<target>
다음 auth flow를 generator가 구현. attacker가 공격 발굴.

POST /login → JWT 발급 (HS256, 24h)
Authorization: Bearer <jwt> → API 보호된 endpoint 접근
POST /refresh → 새 JWT
</target>

<output-format>
Generator: 구현 코드 + 사용 가정 + 알려진 weakness 사전 대응.
Attacker: 각 발견:
- severity (critical/high/medium/low — 도메인 정의 따름)
- 공격 시나리오 (한 문단, 실행 가능)
- evidence (CVE·RFC·case 인용)
- 방어 권장 (한 문단)
</output-format>

<severity-definitions>
critical = token 위조·session hijack·pre-auth bypass
high = post-auth privilege escalation·session fixation
medium = info disclosure·rate-limit 우회
low = best practice 미준수 (functional impact 없음)
</severity-definitions>
```

---

## `--worker-instructions`

양 역할에 동일 적용.

**Use**
- 도메인 framing — "Treat as RFC 8725 (JWT BCP) compliance"
- evidence threshold — "Reject findings without CVE·RFC·published case"
- scope 강화 — "Ignore DOS attacks below 10 req/sec"

**Skip**
- 자동주입 중복 (양 역할 모두)
- 역할별 차별 instruction 필요하면 task 안의 별도 섹션으로

---

## Models / parameters

### `--models`
- **min 2 강제** (engine)
- 권장: generator 1 + attacker ≥2 (다른 provider). attacker 다양성이 발견 다양성에 직결
- 같은 family generator + attacker는 self-judge bias 유사 — 가급적 다른 provider

### `--max-rounds`
default **2** (`wire.ts`).
| 값 | 사용 |
|---|---|
| 2 | gen → attack → gen 재반영. 일반 |
| 3-4 | 중대 보안 검토, attacker 추가 발견 라운드 |
| 1 | gen만 또는 attack만 — 비권장 (red_team 의미 약화) |

### `--count`
generator 1 + attacker N. attacker 다양화로 false negative 감소.

---

## Read output

### convergence judge 의미 약화
`inspect`의 convergence는 동일 task에 평행 응답 비교 — red_team은 비대칭이므로 무의미. inspect 사용 시 quality findings만 활용.

권장: 응답 직접 read.

### 결과 분류
- generator final 출력 = 강화된 산출물
- attacker final 출력 = 발견된 vulnerability list (severity 정렬)
- raw round별 attack 진행을 회귀 검증 — 라운드별로 새 vuln 발견 vs 동일 vuln 재서술

### 합성
- attacker의 critical/high를 dedupe·rank
- generator final이 critical/high 모두 mitigate했는지 검증
- 미해결 critical 있으면 산출물 채택 금지
- attacker가 "robust" 선언 시 confidence: 모든 attacker 동의 후 채택. 1명만 robust면 보수적으로 vuln 남았다고 가정

### False positive 검증
attacker 발견 중 다음 패턴은 의심:
- evidence·CVE 인용 없음 → 자동 주입 "do not fabricate" 위반 가능 — 무시 또는 제외
- "이 코드는 input validation 부족하다"라는 일반론 — 구체 attack scenario 없으면 무시
- severity inflation (모두 critical) — task의 severity 정의 위반

---

## Re-run / abort

**Re-run**
- attacker 모두 "robust" 선언 → false negative 의심. broader pool 또는 attacker만 다른 provider로 재실행
- attacker 발견 모두 일반론·fabricate 의심 → threat model + evidence 강제 보강
- generator가 attacker 지적 무시 → "각 attack에 대한 명시적 mitigation 표시" 강제 추가
- `self_judge_bias` (provider 겹침) → narrower pool 또는 다른 attacker provider

**Abort**
- 2회 재실행에도 attacker 발견이 fabricate 패턴 지속 → task threat model 또는 scope 근본 결함. 사용자 escalate
- generator 또는 attacker 모두 fail → policy violation 가능성, 사용자 escalate
- ≥2 provider 미달

---

## Edge cases

| 상황 | 행동 |
|---|---|
| `roles` 미지정 시 기본 분배 불명 | API 호출 시 항상 `roles` 명시 — 기본 동작 의존 회피 |
| Generator 첫 라운드 출력이 형식 violation | attacker가 공격 surface 못 잡음. 첫 라운드 출력 read 후 task 명확화하고 재실행 |
| Attacker가 generator 산출물 외 영역 공격 (off-target) | scope·threat model 명시 보강 후 재실행 |
| 모든 attacker 결과 critical만 | severity 정의 task 안에 명시. 워커가 inflate한 결과 무시 또는 제외 |
| `modelSwaps` 발생 | swap된 워커 역할 동일하게 유지되는지 확인. role drift 시 결과 폐기 |
| Sensitive content (실제 prod credential·CVE 진행 중) task에 포함됨 | task fan-out 이슈 — 모든 워커 provider가 read. 실제 secrets 절대 금지, sanitize된 fixture 사용 |
