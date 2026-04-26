# SHARED_IMPROVE.md

`.claude/skills/pyreez/shared-convergence.md` 완벽화 계획.

본 문서 자체는 plan 문서(`.claude/skills/` 외부, repo root). audience rule은 plan이 shared-convergence.md에 **쓰는 내용**에 적용된다.

---

## Audience rule (강제)

`feedback_skill_audience.md` 본문 직접 인용:
- `.claude/skills/` 안에 **내부 코드 line 번호** 금지 (engine.ts:1321 류)
- **내부 bug ID (P1-P7)** 금지
- **academic citation chain** 금지 (논문명·연도·저자)
- 모든 정보를 **행동·관찰 가능한 사실**로 변환

→ Phase 1.4가 추가하는 모든 항목은 위 rule 통과 후에만 file에 기입.

---

## 현 상태

- 자연 iterate 3회 완료 (forced 1회 + 자연 2회)
- 직전 padding 추가됨 (Edge cases 섹션 일부, ML/frontend examples) — Edge cases는 행동 룰이라 보존, 도메인 예시는 일반론 확장이라 삭제 대상
- 전문자료 04·06·08은 본 세션에서 1회 surface read 단계 (깊은 internalization 안 됨)
- pyreez 내부 코드 직접 read 완료 (검증 결과는 1.2 종결 항목)

→ **완벽 아님**.

---

## Phase 1 — 인지 강화 + research-grounded 정정

비용 0, 즉시. 내가 직접 수행.

### 1.1 깊은 재read (research)
- `docs/research/04-llm-as-judge.md` — judge bias 현상, pairwise vs absolute 차이, RCAF 구조, self-enhancement
- `docs/research/08-reasoning-models-2026.md` — reasoning model에서 reasoning method instruction의 효과, multi-step framing vs method instruction 구분, reasoning effort는 API parameter 영역
- `docs/research/10-instruction-adherence.md` — XML, CoVe, Self-Refine, few-shot pos/neg, verifiable instruction 패턴, 5 constraint types
- `docs/research/02-multi-agent-debate.md` §"MAD vs self-consistency" — MAD가 단일 강모델+self-consistency 대비 우위 증명 부족 (When-to-skip 보강용)
- `docs/research/07-protocol-specific.md` §"persuasion adversarial" — prompt-only defense 무효, structural defense (외부 evidence citation 강제) 필요

### 1.2 코드 read (종결)
- `src/model/registry.ts`, `src/model/types.ts` — **결과**: reasoning capability flag 없음. `benchmark.reasoning`은 numeric score일 뿐 "reasoning model 여부" 판별 불가. → file에서 "reasoning model에서는" 같은 분기 표현 금지. 일반 워커 행동 룰로 통합.
- `src/inspect/` — convergence-judge·acceptance·alignment-classifier prompt 형태 확인. file의 output 해석 섹션이 inspect 실제 출력과 일치하는지 검증.
- `src/synthesis/fuser.ts` — synthesis 패턴이 file §Synthesis와 일치 확인.

### 1.3 SKILL.md 재read + 책임 경계 정리

직전 변경(shared_convergence specifics + Operational caveats 정정) 정확히 인지. 그리고 다음 중복을 확정 정리:

- SKILL.md "Operational caveats"(modelSwaps·degradation·warnings 등 엔진 레벨 신호) ↔ shared-convergence.md "Edge cases"(failedWorkers·cooldown·modelSwaps·convergence 필드 부재)
- **결정**: 엔진 레벨 신호 일반(modelSwaps·degradation·warnings)은 SKILL.md에 단독 보유. shared-convergence.md "Edge cases"는 shared-convergence 호출 결과 해석에 한정된 항목만 보존(failedWorkers·cooldown으로 인한 풀 고갈·convergence 필드 부재). 양쪽에 동시 등장하는 modelSwaps 항목은 shared-convergence.md 측에서 "vendor policy 위반 시 결과 폐기" 같은 protocol-specific 행동만 남기고 일반 설명은 SKILL.md로 위임 (한 줄 cross-reference).

### 1.4 shared-convergence.md 정정 (audience rule 통과 형태로만)

**삭제**:
- §Examples ML/data 도메인 예시 (line 120-122 근방)
- §Examples frontend 도메인 예시 (line 123-124 근방)

→ 사유: 일반 task 작성 원칙의 도메인별 적용일 뿐, shared-convergence 프로토콜 고유 통찰 아님. 본 protocol에 필요 없는 padding.

**삭제하지 않음 (직전 plan에서 삭제 대상으로 잘못 분류)**:
- §Edge cases 섹션 — deliberate 출력 해석 행동 룰. citation도 코드 line도 아님. 보존. SKILL.md "Operational caveats"와 중복 부분만 점검·정리.

**추가 (행동 지시 형태로만, citation·논문명·연도 금지)**:

A. §"7. 자동주입과 중복 금지" 항목 확장:
> 다음도 박지 마라. 효과 없거나 역효과:
> - "think step by step" / "reason carefully" / "let's think this through" — 워커가 이미 추론하므로 추가 instruction은 무의미하거나 출력 품질 저하
> - reasoning effort 조절 시도 — task 텍스트 영역 아님 (별도 채널)
>
> task에 들어가야 하는 건 **무엇을 답해야 하는지**(problem structure)이고, **어떻게 추론해야 하는지**(reasoning method)는 빼라. 단 "분석은 (1)수집 (2)평가 (3)종합 순서로" 같이 **답이 가져야 할 단계 구조**는 OK — 추론 방식 지시가 아니라 출력 구조 지시이므로.

B. §"7. 자동주입과 중복 금지"의 persona 항목 보강:
> persona ("you are X") — factual·평가 task에서 효과 없음. 단 lens(분석 차원)는 다른 개념 — pyreez가 자동 부여하는 분석 차원을 task에서 또 박지만 않으면 됨.

C. **Read output § `convergence.level` 표의 `high` 행 본문을 다음으로 in-place 교체** (현재 file에 "10-40% 손상시킬 수 있어 HIGH의 결정적 주장은 외부 도구나 다른 모델로 cross-check" 형태로 들어 있는 cell):
> 응답 직접 read해 evidence quality 확인. heterogeneous에서는 contested topic도 자연 high — high 자체는 sycophancy 신호 X. 단일 강한 misleader가 그룹 정확도를 크게 떨어뜨릴 수 있어 HIGH의 결정적 주장은 외부 도구나 다른 모델로 cross-check.

→ 정량 인용("10-40%") 제거, 행동(cross-check)만 유지.

D. **Read output § `confidence` 단락 본문을 다음으로 in-place 교체** (현재 file에 "HIGH는 face value 아님 — 실제 정답률 70-80%" 형태로 들어 있는 단락):
> HIGH/MEDIUM/LOW 자동 파싱 (한국어 `신뢰도:` 포함). 동률 시 보수적인 것. HIGH는 face value 아님 — confident인데 evidence 약하면 red flag. 응답 직접 read해 evidence 검증.

→ "70-80%" 정량 제거, 행동(read·검증)만 유지.

E. §When to skip 보강 (현재 5개 항목 끝에):
> - 단일 강모델 + self-consistency로 더 싸게 같은 품질 가능한 task — heterogeneous 다양성이 답 품질에 기여 안 함

F. §"5. False-premise 거부" 다음에 §"5b. Misleader 방어" 신설 (또는 기존 5에 통합):
> "be objective" / "다양한 관점 고려" 같은 prompt-only defense는 의도적 misleader에 무효. structural defense:
> - task에 "각 주요 주장에 외부 evidence(benchmark·official source·production case) 한 개씩 인용 필수" 명시
> - 또는 `--worker-instructions`에 evidence citation 강제 구문 추가 (이미 §`--worker-instructions` Use 항목에 있음 — 본 5b에서 misleader 컨텍스트로 cross-link)

**G 항목 검토 후 기각**: 서브에이전트 3은 "Pre-flight checklist self-verify를 위한 sample phrase 부재"를 chicken-and-egg로 지적했으나, 직접 확인 결과 §7 자동주입 항목 본문에 sample phrase 7개(`HIGH/MED/LOW 표기`, `"consensus 의존 마라"`, `"evidence ground"`, `"검증하라"`, `"여러 접근 고려"`, `"강한 반론"`, `"no preamble"`)가 이미 존재. agent self-verify 가능. G 추가 불필요(redundant).

**보강 가능 시**:
- IFEval 스타일 verifiable instruction을 §3에 명확화 (이미 있으나 패턴 사례 1개 추가)
- 5 constraint types 프레임워크 (Content/Situation/Style/Format/Example)로 §전반 재구조화 검토 — 본 plan 범위 안 (필수 X)

---

## Phase 2 — 자연 iterate (서브에이전트, 최소 N=2)

비용 ~20-30 LLM 호출.

### 2.1 시나리오 선정 (2개)
- 지금까지 도메인: backend 언어 / 마이그레이션 / runtime 비교 (모두 backend)
- **시나리오 A**: 새 도메인 1 (ML 또는 frontend 또는 data 중 택 1)
- **시나리오 B**: 새 도메인 2 (A와 다른 도메인)
- type 분포: 하나는 단일 추천 형태, 하나는 contested 트레이드오프 — shared-convergence가 자연 trigger되는 형태

→ 사유: N=1은 통계 기반 약함. N=2로 도메인·task type 변동 모두 노출.

### 2.2 subagent 실행 (각 시나리오)
- skill description만 제공 (이전 자연 테스트 패턴)
- subagent 자율 판단: skill trigger → protocol 선택 → playbook load → task 작성 → invoke → 해석 → 합성·재실행 결정
- 강제 X. 자연 흐름.

### 2.3 결과 audit (각 시나리오 + 합산)
checklist:
- (a) file의 모든 specific 기법이 적용됐는가
- (b) 출력이 의도대로 나왔는가 (blind spot 발굴, 합성 가능성)
- (c) file에서 모호하거나 빠진 부분이 있었는가
- (d) agent가 file 안 본 곳에서 guess한 부분이 있었는가
- (e) Pre-flight checklist의 "자동주입 중복 없음" 항목을 agent가 self-verify 가능했는가 (verify 가능했으면 file이 충분, 불가능했으면 §자동주입과 중복 금지에 sample phrase 1-2개 추가 필요)

### 2.4 gap 정량 임계
- 새 gap = 위 (a)-(e) 중 file 직접 수정으로만 해결 가능한 항목 (코드 fix·새 도메인 추가는 제외)
- **수렴 판정**:
  - 양 시나리오 모두 새 gap 0건 → 수렴
  - 합산 ≤ 1건 또는 모두 wording 미세 조정 (구조 변경 없음) → marginal, 수렴 선언
  - ≥ 2건 또는 구조 변경 동반 → substantial gap, Phase 3 진입

### 2.5 gap fix
2.3-2.4에서 surface된 gap 적용 (audience rule 통과 후).

---

## Phase 3 — 수렴 확인 또는 1회 추가

비용 ~10-15 LLM 호출 (필요 시).

### 3.1 Phase 2 정량 임계 적용
- 수렴/marginal → **수렴 선언, 종료**
- substantial gap → 1개 시나리오 추가 자연 iterate (3.2)

### 3.2 추가 iterate 1회
- 도메인은 Phase 2와 다른 새 영역 (ex: A=ML, B=frontend였으면 C=data)
- 결과는 다시 2.4 임계 적용

### 3.3 stop 조건
어떤 경우든 Phase 3에서 stop:
- 추가 iterate는 별도 승인 필요
- Phase 1·2·3로 도달 가능한 상한 = 본 plan의 정의된 "완벽"

---

## Phase 4+ — 별도 승인 필요 영역

본 plan 범위 밖. 사용자가 별도 결정.

### Phase 4 — pyreez 코드 fix
file workaround의 root cause 제거. 본 plan은 audience rule상 코드 line·bug ID를 plan 문서에서도 노출 가능하나(plan은 skill 외부), 적용 시 file 본문에는 행동 표현으로만 들어감.

영역 (요약, 세부는 별도 PROBLEM.md):
- worker round 입력 컨텍스트의 XML escape 비대칭 (한 분기에서만 escape 적용)
- cold-join 시 컨텍스트 중복 가능성 (케이스 의존 — 과거 라운드 transcript와 현재 라운드 others가 동시 노출되는 경로 존재. 실제 텍스트 중복 여부는 케이스별 검증 필요)
- 조기 종료 게이트가 max-rounds 2에서 작동 안 하는 조건
- max-rounds 1에서 lens·anti-conformity 활성 정책 결정
- lens vs `--worker-instructions` 정책 모순
- 자동주입 depth 문구의 reasoning model 영향
- 명칭(`shared_convergence`)과 `ANTI_CONFORMITY` 신호의 의미 충돌
- convergence-judge가 task 형태 검사 안 하고 항상 reframe 액션 emit
- CLI deliberate stdout/stderr 분리

→ Phase 4 후 file의 "max-rounds 1·2 금지" 같은 workaround 제거 가능.

### Phase 5 — 정량 bench 측정
file에 정량 표현을 다시 넣을 수 있는지 결정하는 측정. 단 audience rule상 file 본문에는 여전히 행동 형태로만 들어가고, 정량 결과는 docs/research에 둠.

영역:
- HIGH 라벨의 calibration (verbalized confidence)
- 단일 misleader 의도 주입 시 정확도 손상 측정
- ≥3 distinct provider ablation
- lens on/off × task type ablation
- pyreez vs single-strong-model+self-consistency baseline (shared-convergence 사용 정당화 게이트)

비용·인프라: bench 확장 필요.

### Phase 6 — 외부 검증
- multi-agent 연구자 review
- prompt engineering 전문가 review
- pre-registration

수주~수개월. 사람 의존.

---

## 진행 결정 권한

| Phase | 권한 |
|---|---|
| 1 | 자동 진행 가능 (비용 0, 권한 내) |
| 2 | 사용자 GO 신호 후 진행 (subagent 호출 비용 발생) |
| 3 | Phase 2 정량 임계로 자동 결정. substantial gap 시에만 사용자 보고 후 추가 |
| 4-6 | 별도 승인 (각 phase별) |

---

## "완벽" 정의

본 plan의 "완벽":
- Phase 1·2·3 종료 시점 = research·iterate 검증 + audience rule 통과 형태로만 기입된 file
- Phase 4 미진행 시 file에 workaround 일부 잔존 (max-rounds 1·2 금지 등)
- Phase 5 미진행 시 file은 정량 표현 없이 행동 룰로만 운영
- Phase 6 미진행 시 외부 cross-validation 없음

→ Phase 1·2·3만으로 도달 가능한 = **"본 corpus·코드·iterate로 도달 가능한 상한"**.
**"절대 완벽"은 Phase 4·5·6 동반 필요.**

---

## 직전 plan 대비 변경점

1. Audience rule 강제 섹션 신설 — 모든 Phase 1.4 추가가 통과해야 할 게이트
2. Phase 1.4 추가 항목을 academic citation 제거·행동 지시 형태로 재작성 (A-F)
3. Phase 1.4 삭제 항목에서 Edge cases 제외 (보존)
4. Phase 1.2의 registry reasoning capability 분기 제거 → "없음" 확정 후 file에 분기 표현 금지로 통합
5. Phase 2 시나리오 N=1 → N=2, gap 정량 임계 (2.4) 신설
6. Phase 1.4 §When to skip에 self-consistency baseline 보강 추가 (E)
7. Phase 1.4 §misleader 방어(structural defense) 추가 (F)
8. Phase 4 영역 표기를 코드 line·bug ID에서 영역 설명으로 (plan 문서 자체도 가독성 개선). cold-join 중복은 케이스 의존으로 표현 약화.

## 2차 cross-check 후 추가 변경점

9. Phase 1.4 C·D를 "in-place 교체" 형태로 명시 (어느 cell·단락의 본문을 무엇으로 바꿀지 quote 대비)
10. (서브에이전트 3 지적 chicken-and-egg는 file 직접 확인 결과 §7 line 76에 sample phrase 7개 이미 존재 — 추가 불요로 기각)
11. Phase 1.3에 SKILL.md ↔ shared-convergence.md 중복 정리 결정(엔진 레벨 신호는 SKILL.md 단독, protocol-specific만 shared-convergence.md 보존) 명시
12. Phase 4 "cold-join 시 컨텍스트 중복" → "케이스 의존, 검증 필요"로 약화 (코드 직접 read 결과 mutually exclusive 아니지만 항상 중복도 아님)
