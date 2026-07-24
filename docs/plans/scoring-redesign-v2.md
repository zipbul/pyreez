# 설계안 v2: 모델 점수 시스템 (v1 리뷰 반영 재작성)

상태: REJECTED — 3자 전원(grok·codex·opus) 2라운드 리뷰 완료
날짜: 2026-07-15
선행: scoring-redesign.md (v1, 3자 리뷰로 기각)

## 최종 종합: 두 재작성 + 6개 적대 리뷰(3리뷰어 × 2라운드) 전원 REJECT

### 근본 벽 (설계 디테일 아님 — 요구사항의 통계적 한계)
세 리뷰어가 v1·v2 양쪽에서 독립 수렴: **심의 워커 출력은 모델 단독 능력의 깨끗한 신호가 아니다.**
출력 = f(모델, 과제, 렌즈, 피어, 라운드, judge, 역할). 채점 방식(절대/쌍대)을 바꿔도 역할·위치·
질문·상호오염 교란은 안 사라진다. "채점 가능(숫자를 뽑는다) ≠ 능력 신호(숫자가 모델 강도를 잰다)".
증거: opus가 v1 권고("6프로토콜")를 v2에서 뒤집음("3종만"). 리뷰어조차 라운드마다 입장이 바뀜.

### codex가 v2에서 새로 잡은 확정 결함 (내가 코드·수학 재확인)
- **[치명] axes 게이트 미제거 + DEFAULT_AXES 0건**: "기본 ON"이 이름만 옵트인. 호스트가 --axes를
  안 주면 scoreResponse가 `{}` 반환(rubric-judge.ts:76). v1이 죽은 이유(축적 0건)가 재발.
- **[치명] z-정규화 n=2 대수적 붕괴**: 항상 ±1(크기 무관), a=b면 NaN. adversarial_debate·red_team의
  최소 팀 크기가 2(wire.ts:232-236) → 두 프로토콜 floor에서 정규화가 정보 전멸.
- **[높음] interrogate 실명 유출** (cli.ts:588 `model: entry.model`): v2가 언급조차 안 해 v1보다 후퇴.
- **[높음] judge 폴백 이해상충**: adversarial 2워커에서 팀밖 provider 부재 시 논쟁 상대가 서로 채점
  (자기채점 회피는 자기 출력만 막음, wire.ts:314).
- **[중간] rubric 앵커 0%**: RUBRIC_SYSTEM에 밴드 정의 없음(rubric-judge.ts:12). D-A2 "이미 일부 함" 거짓.
- **[중간] provider≥2 우회**: 동일 provider 복수모델로 제약 충족 → 단일 provider 편중 가능(Q5 답).
- **[중간] 마이그레이션 시차**: 축적 0은 스냅샷. P6 삭제 전 --topic+--axes 런이 데이터를 쌓으면
  가드 없이 소실.

### 판정
개별 결함(톰슨 공식·axes·z-정규화·유출·이해상충)은 v3에서 고칠 수 있으나 **근본 벽은 못 고친다.**
v3 반복은 같은 벽에 재충돌. 결정은 아래 §선택지 — 제품 결정이라 사용자 몫.

### 선택지
1. **범위 대폭 축소**: 동질 3종(shared_convergence·adversarial_debate·evaluation_scoring)만,
   고정 judge(정규화 없음, 원점수), 톰슨 공식 수정(정규-정규 켤레), 옵트인 --auto-team, 정직한
   한계 명시. → "최적 자동선택"이 아니라 "3개 프로토콜의 대략적 모델 선호 힌트". req 상당부분 포기.
2. **기능 폐기**: affinity 축적 0건 + 프로덕션 소비자 0(이번 감사서 확인). 점수 시스템 전체 삭제,
   호스트 직접 선택(--models) 유지. CLAUDE.md의 BT 거짓서술만 수정.
3. **v3 반복**: 근본 벽 미해결이라 권하지 않음.

---


## 2차 리뷰 판정: REJECTED (내가 코드·수학으로 재확인)

### 내가 v2에서 새로 만든 확정 결함
- **[치명] 톰슨 분산 공식 수학 오류** (D-C1): `Normal(mean, var/n + prior_var)`는 n→∞여도
  분산이 prior_var 아래로 안 내려감(실측: n=10000에서 400.01) → **exploit 수렴 불가**.
  정규-정규 켤레는 정밀도의 합 `1/(1/prior_var + n/var)`로 0에 수렴해야 함. grok·opus 독립 지목.
- **[치명] D-A1 ↔ D-A2 자기모순** (opus S1): D-A1은 "워커 A 점수는 B와 무관(독립)"이 전제인데
  D-A2의 z-정규화 `z(A)=(raw_A - mean(run))/sd(run)`는 **정의상 B의 함수**. 독립 주장을 스스로 무효화.
  게다가 n=2에선 z가 항상 (±0.707)로 고정 → 2점차와 75점차가 동일 → 크기정보 전멸(opus S4).
- **[치명] 기본 ON인데 axes 공급원 없음** (grok S0-C): 채점은 `input.axes?.length` 요구(wire.ts:307),
  axes는 host-authored 옵셔널(types.ts:165), 없으면 scoreResponse가 `{}`(rubric-judge.ts:76).
  기본 axes 정의 0줄.
- **[치명] red_team generator 영구 미채점** (grok S0-B): red_team 기본 2R(wire.ts:192), 최종 라운드는
  "generators skip"(engine.ts:747), 채점은 최종 라운드만 → generator 점수 구조적 0건. "6프로토콜 전부" 거짓.

### 근본 벽 (v1·v2 두 라운드에 걸쳐 grok·opus 공통 지목 — 채점 방식 무관)

**심의 워커의 출력은 모델 단독 능력의 깨끗한 신호가 아니다.**
출력 = f(모델, 과제, 렌즈, 피어, 라운드, judge, 역할). 절대점수로 바꿔도 이 교란은 안 사라진다:
- sequential_refinement: 워커 C 출력에 A·B 기여 포함 → C rating에 A·B 성과 귀속 (위치 교란)
- red_team: generator(아티팩트) vs attacker(공격)를 같은 축으로 채점 = 카테고리 오류 (역할 교란)
- host_interrogation: 워커마다 다른 질문 → 질문 난이도와 모델 능력 교란
- shared/adversarial: peer 주입 후 산출 → 모델 단독 능력 신호 아님 (상호오염)

**"채점 가능(숫자를 뽑는다)"과 "능력 신호(숫자가 모델 강도를 잰다)"는 다르다.** v2의 "6프로토콜 전부
유효"는 전자를 후자로 혼동. v1 D4(동질 3종만 채점)가 오히려 정직했다 — opus가 v1 권고("6프로토콜")를
v2 리뷰에서 스스로 뒤집음. 리뷰어조차 라운드마다 입장이 바뀐다 = 쉬운 정답 없음의 증거.

### opus 최소수리 권고 (v3 방향 후보)
(a) 정규화 삭제 + **고정 judge**로 드리프트 상수화, 원점수 저장 (S1·S4 동시 해소)
(b) 채점 대상을 **동질 3종**(shared_convergence·adversarial_debate·evaluation_scoring)으로 명시 제한 — v1 D4가 옳았다
(c) 톰슨 사후를 정규-정규 켤레로 바로잡고 prior_var 실측·문서화
(d) 선택은 축 평균이 아니라 task 관련 축 가중

---


## 0. v1이 왜 죽었나 — 이번에 버리는 것

v1은 3자 적대 리뷰(grok·codex·opus) 전원에게 기각됐다. 죽은 이유와 v2의 대응:

| v1 결함 | v2 결정 |
|---|---|
| 익명이 원리 불가능(셸 호스트가 `ls debug/`로 실명 획득) | **완전 익명 목표 폐기.** "기본 워크플로가 브랜드로 안 고른다"로 축소 |
| 북극성 인과 거짓("익명이 자동선택 강제") | 인과 삭제. 익명·선택·채점은 독립 요구로 각자 정당화 |
| Glicko 오적용(독립 대전 없음) | **Glicko/쌍대비교/UCB 전면 폐기.** 절대점수 독립 채점 + 톰슨 샘플링 |
| judge 회피 상시 불가(실사용 provider 3개) | judge 선정 규칙을 현실(3사)에 맞춤 |
| D4 역설(오염 최악 프로토콜만 채점) | 절대점수는 워커 독립 채점 → 6프로토콜 전부 채점, 프로토콜 배제 없음 |
| llm-judge 재발명 | 신규 채점 모듈 안 만듦. rubric-judge.ts(scoreResponse) 그대로 재사용 |

## 1. 목표 재정의 (v1의 6개 요구 → 달성 가능한 형태로)

| # | v1 요구 | v2 목표 (현실 조정) |
|---|---------|---------------------|
| 1 | 매 실행 리스트업 | discovery 1h TTL 유지 (매 실행 프로브는 grok 지연을 매 심의에 얹어 기각). "리스트업"은 캐시 조회로 충족 |
| 2 | 호스트가 점수로 모델+effort 선택 | **옵트인 `--auto-team`**: pyreez가 점수로 팀 제안. 미지정 시 기존 `--models` 유지(탈출구). effort 자동선택은 v2 제외(D-E) |
| 3 | 모든 프로토콜 종료 후 갱신 | **6프로토콜 전부.** 절대점수는 워커 독립 채점이라 상호오염·비교불가 프로토콜 문제 없음 |
| 4 | 검증된 알고리즘 | 톰슨 샘플링(Beta/정규-근사) — 도메인 외 적용 아님, 온라인 밴딧의 표준. rubric 절대점수는 이미 구현(rubric-judge.ts) |
| 5 | 최적 점수 시스템 | "최적" 주장 안 함. 절대점수의 알려진 약점(포화·편향)을 rubric 앵커링·judge 정규화로 완화하고, 한계를 문서에 명시 |
| 6 | 호스트 익명 | "브랜드 중립 기본 워크플로"로 축소. 완전 익명은 위협모델상 불가 |

## 2. 채점 (D-A)

### D-A1. 절대 rubric 점수, 워커 독립

- 매 심의 종료 후(성공 런만) 최종 라운드 각 워커 출력을 **독립적으로** rubric 채점.
  기존 `scoreResponse(judge, task, axes, response)`(rubric-judge.ts:69) 그대로 사용 — 축별 1-100.
- **독립 채점이 핵심**: 워커 A의 점수는 워커 B와 무관하게 매겨진다 → shared_convergence의
  peer 흡수, sequential의 체인, red_team의 비대칭이 **점수 독립성을 깨지 않는다**. v1 쌍대비교가
  버려야 했던 프로토콜 3개가 여기선 전부 채점 가능.
- 기본 ON, `--no-scoring` 옵트아웃. degraded/실패 런은 스킵.

### D-A2. 절대점수 약점의 국소 수리

절대 LLM 점수는 포화(다 80점대)·judge 편향(장문·자신감 선호)이 알려진 약점이다. 완전 해결은
불가하나 다음으로 완화하고, **못 고치는 부분은 문서에 한계로 명시**한다:

- **rubric 앵커링**: 각 축에 점수대 정의를 프롬프트에 박음(90-100=X, 70-89=Y...). 이미 rubric-judge가
  일부 함(buildRubricMessages 확인 필요) → 앵커 강화.
- **judge 내 정규화**: 한 judge가 한 런의 워커들을 채점할 때 z-정규화(런 내 평균/표준편차)해서
  절대 스케일 드리프트를 런 단위로 상쇄. 저장은 정규화 전 원점수 + 정규화 계수 둘 다.
- **한계 명시**: "이 점수는 judge의 취향을 포함한다. 단일 judge 편향은 완전히 제거되지 않는다"를
  `ratings` 커맨드 출력과 문서에 표기.

### D-A3. judge 선정 (현실: 실사용 provider 3개)

- gemini는 discovery에 없어 실사용은 openai/xai/anthropic 3개(cli.ts:162-166). "팀 밖 provider judge"는
  3워커 팀에서 불가능 → v1처럼 전제하지 않는다.
- 규칙: **팀에 없는 provider 우선 → 없으면 팀 내 최저 참여 모델(자기 채점 회피는 유지: 자기 출력은
  안 매김) → 그것도 불가면 채점 스킵 + `scoring_skipped: no_neutral_judge` 기록**. 폴백을 전부 정의.
- judge 자기 출력 제외는 기존 로직 유지(wire.ts:313 `resp.model === deps.judge.model` continue).

## 3. 레이팅 저장·집계 (D-B)

### D-B1. (model, domain, axis) → (mean, n, M2)

- 기존 affinity의 증분평균 `(mean, n)`(affinity.ts:58)에 **분산 누적 M2**(Welford) 추가.
  톰슨 샘플링에 분산이 필요.
- 저장: `.pyreez/ratings.json`
  ```json
  { "v": 2, "updatedAt": 0,
    "domains": { "backend/db": {
      "openai/gpt-5.5": { "정확성": { "mean": 78.2, "n": 14, "m2": 920.5 } } } } }
  ```
- 도메인 백오프: 얇은 노드는 부모→전역으로 n-가중 블렌드(신규 도메인 즉시 동작).
- **affinity 전량 교체**: 기존 로그·트리·`affinity`/`affinity-compact` 커맨드 삭제(축적 0건, 마이그레이션
  불요), `pyreez ratings`로 대체.

### D-B2. 도메인 분류

- `--topic` 있으면 그대로. 없으면 채점 judge 호출에 1계층 분류를 얹음(추가 콜 0).
- 드리프트 우려(같은 과제가 다른 도메인으로 분류 → rating 희석): 고정 taxonomy 12개 카테고리를
  judge에 제시하고 그중 택1 강제(자유생성 금지). 미해결이면 "general".

## 4. 자동 팀 선택 (D-C, 옵트인)

### D-C1. `--auto-team N` 톰슨 샘플링

- `--models` 미지정 + `--auto-team N` 시 pyreez가 N개 팀을 뽑는다.
- 알고리즘: 각 (model, domain)에서 축 평균 점수의 사후분포 `Normal(mean, var/n + prior_var)`에서
  1회 샘플 → 샘플값 상위 N. 톰슨 샘플링은 탐색·활용을 사후분산으로 자동 조절(별도 UCB 상수 c 불요).
- 하드 제약: **provider ≥ 2**(단일 provider 팀 금지, 기존 provider_diversity_low 경고를 제약 승격),
  쿨다운 제외는 **런 시작 시점엔 항상 비어있으므로**(codex 지적) 대신 "직전 실패 영속 로그"를
  선택적으로 참조 — v2에서는 쿨다운 연동을 **하지 않는다**(공허한 서술 제거). 실패 회피는 엔진
  fallback이 이미 런 내에서 처리.
- **중복 모델 슬롯 금지**: `--auto-team`은 서로 다른 모델만 뽑는다(자기-대-자기 문제 원천 차단).
  N > 가용모델수면 가용 전체로 clamp.

### D-C2. 콜드스타트

- 축적 0 또는 n이 얇은 셀: 사후분산이 커서 톰슨이 자연히 넓게 탐색(별도 처리 불요).
- 단, **초기 탐색이 실사용 품질에 주는 비용을 문서에 명시**하고, `--auto-team`을 옵트인으로 둬서
  사용자가 감수 여부를 선택하게 한다(기본은 여전히 `--models` 명시).
- 피드백 락인 완화: 톰슨은 사후분산이 살아있는 한 저평가 모델도 가끔 뽑는다(UCB의 결정론적
  락인보다 유리). 완전 해결은 아니며 한계로 명시.

## 5. 익명 (D-D, 축소된 목표)

### D-D1. 목표: "기본 워크플로가 브랜드로 안 고른다" (완전 익명 아님)

- 완전 익명은 셸 호스트에게 불가(3자 리뷰 합의). 위협모델을 "결연한 적대 호스트"에서 "기본
  워크플로에서 브랜드 편향이 안 새는 것"으로 하향.
- 조치:
  - `--auto-team`을 **문서화된 기본 선택 경로**로. 호스트 스킬에서 `--models` 수동지정과 로스터
    열람(`discover`/`ratings`)을 **권장하지 않음**으로 안내(강제 아님, 규약).
  - stdout **및 stderr** 실명 제거: onRound stderr 로그(cli.ts:344)도 익명 라벨로. v1이 놓친 채널.
  - 콘텐츠 자기서명은 스크럽하지 않음(비용 대비 효과 낮고 불완전) — 한계로 명시.
  - debug 캡처는 실명 유지(사람 전용). 파일명 실명(transcript.ts:47)도 유지 — "브랜드 중립"
    목표엔 debug 열람이 위협이 아님(사람이 보는 것). 완전 익명을 포기했으므로 일관됨.
- **v1의 자기모순 제거**: v1은 "완전 익명" 주장하며 debug에 실명 보존 → 모순. v2는 목표를
  낮췄으므로 debug 실명 보존이 정합적.

## 6. 제외 (D-E) — v2 범위 밖, 명시적 renegotiation

- **effort 자동선택**: "과제 난이도 추정"이라는 별개 문제. v2는 effort를 채점 레코드 공변량으로만
  기록. req#2의 effort 절반은 **명시적으로 v2에서 뺀다**(사용자 인지 필요).
- **완전 익명**: D-D로 축소.
- **쌍대비교/Glicko/UCB**: 전면 폐기.

## 7. 구현 단계

| P | 내용 | 파일 |
|---|------|------|
| P1 | ratings 저장소 (Welford (mean,n,M2)) + 백오프 | model/ratings.ts (신규), validation/schemas.ts |
| P2 | 종료 후 독립 rubric 채점 + judge 정규화 + judge 폴백(D-A3) | wire.ts(affinity 블록 교체), rubric-judge.ts(앵커 강화) |
| P3 | 도메인 분류(고정 taxonomy) | rubric-judge.ts 또는 신규 classify 훅 |
| P4 | `--auto-team` 톰슨 선택 (provider≥2, 중복금지) | wire.ts, team-composer.ts, cli.ts |
| P5 | stdout+stderr 익명 라벨 | cli.ts, engine.ts(onRound 페이로드) |
| P6 | affinity 삭제 → `ratings` 커맨드, CLAUDE.md의 BT 거짓서술 수정, 호스트 스킬 갱신 | cli.ts, model/affinity.ts(삭제), CLAUDE.md, .claude/skills/ |

## 8. 테스트

- Welford: 증분 mean/var 정확성, 백오프 블렌드 경계값.
- 톰슨: 사후분산 큰 셀이 넓게 샘플, provider≥2 제약, 중복모델 금지, `--models` 탈출구.
- judge 폴백: 팀밖 provider 없을 때 최저참여→스킵 순서, 자기채점 회피.
- 정규화: 런 내 z-score, 원점수+계수 동시 저장.
- 익명: 실명이 stdout **및 stderr**에 안 나가는 것(둘 다 grep). debug는 실명 유지 확인.
- E2E: 실모델 2런 → ratings.json 갱신 → `--auto-team` 3번째 런 선택이 영향받음.

## 9. 정직한 한계 (문서에 남길 것)

1. 단일 judge 편향은 완전 제거 안 됨(정규화로 런 단위만 상쇄).
2. LLM 절대점수 포화는 앵커링으로 완화하나 잔존.
3. `--auto-team` 초기 탐색은 실사용 품질 비용 발생(옵트인으로 사용자 선택).
4. 익명은 "브랜드 중립 기본 워크플로"까지만. 결연한 호스트는 debug/콘텐츠로 실명 추론 가능.
5. 도메인 분류는 judge 판단 — 고정 taxonomy로 드리프트 줄이나 오분류 잔존.

## 10. 2차 리뷰 질문

- Q1. judge 정규화(런 내 z-score)가 n=2 런(표준편차 불안정)에서 과교정하지 않나?
- Q2. 톰슨 prior_var 초기값을 뭘로? 너무 크면 콜드스타트 무작위, 작으면 탐색 부족.
- Q3. 고정 taxonomy 12개가 실제 과제 분포를 덮나, 아니면 "general"로 대부분 몰리나?
- Q4. 절대점수 유지가 정말 쌍대비교보다 나은가 — grok/codex의 "포화" 반론에 D-A2 완화가 충분한가?
- Q5. provider≥2 하드제약이 3-provider 현실에서 팀 다양성을 실제로 확보하나, 아니면 항상
      같은 3사 조합으로 수렴하나?
