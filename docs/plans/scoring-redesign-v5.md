# 설계 v5: 주제별 모델 강점 점수 시스템 (3자 리뷰 종합 확정안)

상태: CONFIRMED — 실측 6 게이트 통과 (2026-07-16)

게이트 결과: 전 호출 webAccess=false 통제 재측정 — medicine 역전(grok>gpt>opus) 유지.
실측5의 grok 1위는 도구 교란이 아니었다. 부수 확인: 강한 신호(law 12점차)는 런 간 안정,
약한 신호(chemistry·history 0.7점차)는 런마다 뒤집힘 → σ²_floor·샘플 임계 설계의 실증적 근거.
날짜: 2026-07-16
선행: v1~v3(기각) → 실측 1~5 → v4 → **3자 직접 리뷰(fable·codex·grok, pyreez 미사용)** → v5

## 0. v4 리뷰 결과 — 3자가 합치·고유로 깬 것과 v5의 대응

| 결함 (발견자) | v5 대응 |
|---|---|
| **자기배제 judge = 모델마다 다른 저울** — opus는 (openai,xai), grok은 (anthropic,openai) 쌍으로 측정. judge 척도차(실측2: 같은 답 15점차)가 신호(9~15점)와 동일 자릿수인데 모델 간 비교 불가 (fable C1, 고유) | **자기배제 폐기.** 실측 2·5가 검증한 측정기 그대로: **3사 공통 judge 패널**(provider당 1개 고정 모델: sonnet · gpt-5.4-mini · grok-4.5)이 런의 전 워커를 채점. 공통 저울 복원. self-preference는 **n=3 중앙값**이 이상치 1명을 기각(실측2가 증명한 바로 그 구조) |
| sequential R1 비격리(worker≥1이 previous-version 수신, engine.ts:607-618), red_team attacker R1 부재(engine.ts:734-736) (codex CRITICAL, grok·fable 합치) | 채점 대상 = **shared_convergence · adversarial_debate · evaluation_scoring 3종만** (피어 격리 + 런 내 동일 과제). sequential(체인)·red_team(역할 비대칭)·host_interrogation(워커별 질문 상이) 제외. "R1이면 프로토콜 무관"(v4 §2)은 거짓이었음 — 회수 |
| 셀 키에 protocol 부재 — SC(분석)/ADV(약점목록)/eval(심사문)은 과제 종류가 달라 같은 셀이면 프로토콜 혼합물. 기존 affinity도 protocol 루트였음(affinity.ts:40) (전원) | 셀 키 = **(model, protocol, topic-path, axis)**. protocol 복원 |
| workerIndex 고정 렌즈/공격각 교란 — lens=`workerIndex%7`(prompts.ts:156), angle=`workerIndex%5`(prompts.ts:379), workerIndex는 --models 순서 그대로(team-composer.ts:63) → 순서 고정이면 렌즈 영구 고정 confound (전원) | (a) 팀 구성 시 **워커 순서 셔플**(런마다 렌즈 배정 회전), (b) raw 로그에 lens/angle 기록(공변량), (c) maxRounds=1의 무렌즈 R1(prompts.ts:155 조건)은 렌즈드 R1과 같은 셀 — raw 로그의 lens=null로 구분 가능, 집계는 v1 통합(한계 명시) |
| 2-judge 중앙값=평균 + 무음 단일-judge 퇴행(judge 실패 시 `{}` — rubric-judge.ts:80) (전원, fable이 쿼럼 부재 고유 지적) | 공통 패널 n=3 복원으로 중앙값 실효. **쿼럼 규칙**: 유효 judge < 3이면 그 워커 채점 폐기(`scoring_skipped: quorum` 기록). 단일-judge 퇴행 차단 |
| 기본 ON + 옵트아웃 부재, 1R 프로토콜 오버헤드 +200%(fable M1 정량) (전원) | (a) **judge 콜 병합**: judge 1명이 런의 전 워커 답을 한 콜에 채점(입력=task+답 n개, 출력=워커별 축 점수) → 런당 judge 3콜 고정(2n 아님). 워커 순서는 콜마다 셔플(위치편향). (b) SC/ADV 기본 3R이므로 오버헤드 3n+3 vs 3n ≈ +33%(n=3). eval(1R)은 +100% → **eval은 기본 OFF, 플래그로 ON**. (c) `--no-scoring` 옵트아웃 신설 |
| rubric에 "형식 무시" 계약 미구현(RUBRIC_SYSTEM에 지시 0줄 — rubric-judge.ts:12) (전원) | P2에 rubric 개정 명시: "길이·형식·문체·명료성 무시, 간결·정확이 장황·오류를 이겨야 한다" + 내용 3축(accuracy/depth/grounding). 실측5에서 이 조합의 변별력 확인됨 |
| 주제 분류 소유자 미정 + 자유 라벨 파편화("pharmacology"/"약리") (codex·fable) | **분류는 채점과 분리된 1콜**(패널 중 지정 1모델). 상위 도메인 = 고정 taxonomy 15종(문서 부록 A) 택1 강제, 하위주제 = 영어 소문자 kebab-case 강제(파편화 억제). judge 2명 분류 불일치 문제 소멸(분류자 1명) |
| Welford n 정의 모호 — judge 관측을 독립 적립하면 상관 표본 과신(v2 오류 재림) (codex) | **n = 런 단위 1관측**: 워커당 (3-judge 중앙값) 1개 값만 셀에 적립. judge별 원점수는 raw 로그에만 |
| 톰슨 σ²=0 붕괴(n=1이면 M2=0→사후 점질량) + 사후평균 식 부재 + 3축→1스칼라 규칙 부재 (fable H3) | 사후: 정규-정규 켤레 명시 — `post_var = 1/(n/max(σ̂², σ²_floor) + 1/prior_var)`, `post_mean = post_var·(n·x̄/max(σ̂², σ²_floor) + prior_mean/prior_var)`. **σ²_floor = 실측5의 judge 중앙값 분산 실측치로 설정**(n<3 셀 점질량 차단). 선발 스칼라 = 3축 단순평균(v1), task-축 가중은 v2 |
| **webAccess 교란 — grok만 web 기본 ON**(grok-cli.ts:88). 실측5가 도구 미통제 → medicine grok 1위가 도구 효과일 수 있음 (fable H4, 고유) | (a) **실측 6 (구현 전 게이트)**: 전 모델 webAccess=false 통제 재측정 → medicine 역전이 유지되는지. (b) 프로덕션: 채점 레코드에 워커별 webAccess 기록(공변량), judge는 항상 web OFF |
| host-instructions가 R1 생성 조건에 유입(prompts.ts:152) — 형식 지시가 생성 쪽에서 교란 (fable L2) | raw 로그에 workerInstructions 유무 기록. 생성 조건 통제는 불가(호스트 권한) — 한계 명시 |
| ratings.json 동시 실행 lost update (fable L1) | 임시파일 작성 후 rename(원자적). 병렬 실행 간 병합은 v1 범위 밖 — 한계 명시 |
| P2 훅 위치: wire.ts는 deliberate 완료 후 제어 수신. 기존 affinity 훅(wire.ts:307, result.rounds 사용)과 동일 자리에서 `result.rounds[0]` 읽으면 됨 (codex) | P2를 그 패턴으로 명시 |

## 1. 확정 설계 (요약)

```
[pyreez 실행 (SC/ADV, --no-scoring 아님)]
  → 종료 후 result.rounds[0] (R1 = 피어 격리 응답들)
  → 분류 1콜: 고정 taxonomy 도메인 + kebab-case 하위주제
  → 공통 judge 패널 3명(sonnet·gpt-5.4-mini·grok-4.5, web OFF), 각자 1콜에 전 워커 채점
     (rubric: 내용 3축, 형식 무시 명시, 답 순서 셔플)
  → 워커별 3-judge 중앙값 1개 = 1관측
  → (model, protocol, topic-path, axis) 셀에 Welford 적립 + raw 로그(judge별 원점수·lens·webAccess·effort)
  → --auto-team N: 셀(적응적 깊이, 부모 prior 백오프)에서 톰슨 샘플 상위 N
     (provider≥2, 모델 중복 금지, 워커 순서 셔플)
```

- 매 실행 갱신(SC/ADV 기본 ON). eval은 플래그 ON. sequential/red_team/interrogation은 미채점.
- 기본 팀 선택은 여전히 --models 수동. --auto-team은 옵트인.

## 1.5 엔드투엔드 사용 흐름 (호스트 관점)

```
호스트: pyreez deliberate --task "..." --auto-team 3          # 모델명 입력 없음
pyreez: ① discovery 캐시 확인(1h TTL, 초과 시 자동 재탐색 — 신규 모델 자동 편입,
          신규 모델은 사후분산 최대라 톰슨이 자동 탐색)
        ② 주제 분류 1콜 (고정 도메인 15종 + 하위주제)
        ③ 해당 셀(적응적 깊이)에서 톰슨 샘플 상위 3 → 팀 확정 (provider≥2, 중복금지, 순서 셔플)
        ④ 심의 실행 — stdout·stderr·onRound 전부 worker-A/B/C 익명 라벨
        ⑤ 종료 후 공통 judge 패널 3콜 → R1 채점 → ratings 갱신
호스트: interrogate --round 1 --worker 0 --question "..."      # 좌표 기반, 이름 불필요
내부:   pyreez ratings                                          # 실명 점수표 — 호스트 API 밖(스킬 미문서화)
탈출구: --models 실명 지정 (개발·테스트 전용, 호스트 스킬에서 미문서화. 출력은 여전히 익명)
```

익명 원칙: pyreez의 사용자는 사람이 아니라 호스트 에이전트(LLM)다. "사람 전용" 채널은
존재하지 않는다 — 익명이 성립하는 근거는 "문서화된 호스트 인터페이스(deliberate --auto-team /
interrogate / acceptance)에 실명이 흐르지 않는다"이다. debug 캡처·ratings 파일은 호스트 API
밖 내부 파일(스킬에 미문서화). 셸 접근 호스트가 작정하고 열면 뚫린다 — 강제가 아니라
"기본 워크플로 브랜드 중립"(3자 리뷰 합의된 현실적 목표).

## 2. 정직한 한계
1. R1 신호 = "혼자 잘함". 반박 수용·정제 능력은 미측정 — auto-team이 심의 시너지를 보장 못 함
   (fable H2). 렌즈 다양성·provider≥2가 완화하나 해소 아님. R2+ 기여 측정은 후속 연구.
2. 3사 공통 패널의 공통 편향(전원이 공유하는 선호)은 중앙값으로 안 걸러짐.
3. maxRounds=1의 무렌즈 R1과 렌즈드 R1이 같은 셀(raw 로그로 구분 가능, 집계는 통합).
4. 사전 주제추정(auto-team 시) ≠ 사후 분류 라벨 — raw 로그로 진단만.
5. 병렬 pyreez 실행 간 ratings 병합 미지원.

## 3. 구현 전 게이트
- **실측 6**: webAccess=false 통제 재측정. medicine 역전(grok>opus)이 도구 없이도 유지되면 진행,
  뒤집히면 도구 축을 셀 키에 승격 후 재설계.

## 4. 구현 단계
| P | 내용 |
|---|------|
| P0 | 실측 6 (게이트) — **통과** |
| P1 | ratings.ts: Welford + 켤레 사후(σ²_floor) + 적응적 깊이 + prior 체인 + 원자적 쓰기 |
| P2 | 채점 훅(wire.ts 기존 affinity 훅 자리, result.rounds[0]) + 병합 judge 콜(런당 3콜) + 쿼럼 + rubric 개정(형식 무시) + raw 로그 |
| P3 | 분류 1콜(고정 taxonomy 15종 + kebab-case 하위) |
| P4 | --auto-team 톰슨 + provider≥2 + 중복금지 + 워커 순서 셔플 |
| P5 | --no-scoring 플래그, affinity 삭제→ratings 커맨드, CLAUDE.md BT 서술 수정, 호스트 스킬 |

## 부록 A. 고정 도메인 taxonomy (15종)
software, medicine, law, mathematics, natural-science, engineering, economics-finance,
history, philosophy-ethics, arts-literature, social-science, education, business-strategy,
everyday-practical, general
