# 설계안: 점수 기반 자동 모델 선택 + 익명 워커 시스템

상태: DRAFT — REJECTED by adversarial review (재작성 필요)
날짜: 2026-07-15

## 리뷰 판정 — 3자(grok·codex·opus) 완료: REJECTED

전원 동일 결론: **현재 형태 착수 불가, 재작성.** 아래는 내가 각 지적을 코드로 재확인한 확정분.

### 전원 합의 (세 리뷰 모두 독립적으로 지목)
- **[치명] 익명은 환상** (D2, §1): 호스트는 셸에서 pyreez를 실행하는 LLM 에이전트다.
  `ls .pyreez/debug/<id>/` 한 줄로 팀 전원 실명(transcript.ts:44 `r{r}_w{i}_{model}.json`).
  stderr도 실명(cli.ts:344), `pyreez ratings`/`discover`도 실명, 콘텐츠 자기서명("built by X")은
  필드 리네임으로 안 막힘. **설계 스스로 "강제 불가, 규약"이라 자백(D2 line 50).**
- **[치명] 북극성 인과 거짓** (§1): "익명(6)이 자동선택(2)을 강제"는 틀림. 선택=실행 전 입력,
  익명=실행 후 출력 → 분리 가능. 익명이 원리 불가능하므로 D1의 정당화가 무너진다.
  D1은 필연이 아니라 **설계 선호**로 재프레이밍되어야 하고 별도 근거 필요.
- **[치명] Glicko 오적용** (D5): 독립 1:1 대전 가정을 3겹 위반 — (a) 같은 런 쌍은 공유 task+
  peer 주입으로 비독립, (b) 단일 judge가 전 쌍 판정 → 측정오차 완전상관 → RD 과축소(과신),
  (c) UCB exploit 수렴 시 강모델끼리만 공출연 → 비교그래프 disconnected → 랭킹 성립 불가.
  Glicko가 재는 것은 모델 강도가 아니라 "이 judge가 이 상호작용을 얼마나 좋아했나".

### codex/opus가 추가로 판 것 (grok보다 깊음)
- **[치명] judge 회피 상시 불가** (D3/Q1): gemini는 discovery 맵에 없어(cli.ts:162-166, google 키 0개)
  실사용 provider가 **3개**(openai/xai/anthropic). 3워커 팀이 3사를 덮으면 "팀 밖 judge" 후보 0.
  Q1이 조건부로 던졌지만 3-provider 현실에선 상수. 폴백 미정의.
- **[치명] D4 역설** (D4): 채점 유지 3종 중 shared_convergence·adversarial_debate는 "share
  positions"(types.ts:19-20)라 출력 상호오염. **진짜 독립 출력은 evaluation_scoring 하나뿐**
  (types.ts:23). 하필 오염 최악 2종을 남겼다.
- **[높음] 재발명** (D3): llm-judge.ts가 이미 양방향 position-bias 완화(forward+swap, 둘 다
  동의할 때만 승자)를 구현하고 **"Do NOT use for high-stakes ranking"**(llm-judge.ts:67) 경고.
  내 D3 신규 모듈은 정확히 그 약한 방식(무작위 단일 순서)을 고위험 용도(영속 레이팅)에 쓴다.
- **[높음] 쿨다운 공허** (D1): cooldown은 런당 생성(wire.ts:217)되고 팀 선택은 그 전. 선택 시점
  쿨다운 셋은 항상 비어있음 → "쿨다운 제외"는 구현 불가 서술.
- **[내 사실오류·회수] 배경표 #3**: "--judge+topic+axes 3중 옵트인"은 거짓. deliberate 케이스
  (cli.ts:298-350)는 flags["judge"]를 0건 읽음. 실제 judge=`PYREEZ_JUDGE_MODEL || modelIds[0]`
  (cli.ts:202) — 미설정 시 조용히 첫 모델. 게이팅 2중(topic+axes), judge는 옵트인 아님. **정정함.**

### 기타 확정
- [높음] req 포기: D4가 req#3("모든 프로토콜"), D7이 effort(req#2 절반) 제외.
- [중간] UCB 무보정: `r+c·RD`, c=1이면 초기 RD 350이 실력차 100점 압도.
- [중간] 콜드스타트 락인: 축적 0 시작, 팀에 오른 모델만 채점 → 안 뽑힌 모델 영원히 미갱신 = 자기강화.
- [중간] 비용: n=4 쌍대비교 6콜 > 절대점수 4콜. 기본 ON 오버헤드 +33~50%.
- [중간] req#1 불일치: D6 1h TTL은 "매 실행"이 아님.

### 리뷰어 간 근본 충돌 (내 판정 필요 — 아래 §재작성 방향)
- **grok+codex**: LLM 절대점수(1-100) 폐기 → 쌍대비교로. 단 "런=1 관측"으로 축소.
- **opus (반대)**: 쌍대비교 폐기 → 절대점수 **유지**. 근거: 쌍대비교는 워커 상호오염
  프로토콜에서 독립 대전이 아니고 6중 사실상 1개(evaluation)만 유효. 절대점수는 워커를
  독립 채점하므로 상호오염 무관 + **6프로토콜 전부 채점 가능**. 포화/편향은 rubric 앵커링으로
  국소 수리. affinity가 이미 (mean,n) 유지(affinity.ts:58) → 톰슨 샘플링 argmax + provider 다양성.

## 재작성 방향 (내 판정 — 사용자 승인 대기)

opus 노선 채택 권고. 이유: (1) 쌍대비교는 6프로토콜 중 4개(share/chain류)에서 통계적으로
무효인데, 절대점수는 워커 독립 채점이라 6개 전부 커버 → req#3을 더 충족. (2) grok/codex가
절대점수를 버리라 한 근거(포화/편향)는 rubric 앵커링·judge 정규화로 국소 수리 가능하고,
그들의 대안(쌍대비교)도 "런=1 관측"으로 축소하면 통계적 이점이 크게 준다. (3) 기존 affinity
(mean,n)·llm-judge 재사용 → 최소 변경. 익명은 원리 불가능이므로 목표에서 내리고, 대신
"기본 워크플로가 브랜드로 안 고른다"(auto-select를 유일 문서화 경로로)로 실질 목표 축소.
effort(#2 절반)와 자동선택이 호스트에서 pyreez로 이동하는 것(#2 재해석)은 사용자 승인 항목.

---

## (v1 DRAFT 원문 — 리뷰로 기각됨, 이력 보존)



## 0. 배경 — 현재 상태와 요구의 간극

| # | 요구 | 현재 |
|---|------|------|
| 1 | 매 실행마다 가용 모델 리스트업 | 24h TTL 캐시 (cli.ts:155) |
| 2 | 호스트가 점수를 근거로 모델+effort 선택 | 호스트가 `--models`/`--reasoning-effort`를 근거 없이 직접 지정. 점수를 읽으라는 문서 0 |
| 3 | 모든 프로토콜 종료 후 (모델, 프로토콜, 도메인, 점수) 자동 갱신 | `--topic`+`--axes`+`--judge` 3중 옵트인 → 실제 축적 0건 |
| 4 | 검증된 점수 알고리즘 | judge 절대점수(1-100)의 증분 평균. CLAUDE.md의 "Bradley-Terry" 주장은 미구현(거짓) |
| 5 | 최적의 점수 시스템 | LLM 절대점수는 포화·편향, 단일 judge, 불확실성·시간가중 없음 |
| 6 | 호스트에게 모델 익명 | 출력 JSON에 실명 전부 노출 (`rounds[].responses[].model`) |

## 1. 북극성

**호스트는 워커를 익명으로만 본다. 팀은 pyreez가 점수로 고른다. 모든 심의는 학습 데이터를 남긴다.**

핵심 인과: 6(익명)이 2(선택)를 강제한다 — 호스트가 모델 실명을 모르면
모델 선택은 pyreez 내부로 들어올 수밖에 없다. 이 설계의 뼈대가 그 이동이다.

```
[discover 1h TTL] → [pyreez가 팀 자동 선택: rating+불확실성 UCB, 프로바이더 다양성 제약]
      → [deliberate: 출력은 전부 익명 라벨 worker-A/B/C]
      → [종료 후: 중립 judge가 익명 출력을 쌍대비교]
      → [Glicko 업데이트: (model, domain)별 rating·RD 갱신]
      → [다음 선택에 반영]
```

## 2. 설계 결정

### D1. 선택 주체 이동: 호스트 → pyreez

- `deliberate`에서 `--models`가 **선택 사항**이 된다. 기본 동작: pyreez가 팀을 뽑는다.
- 선택 알고리즘: 도메인별 유효 rating의 **UCB** — `score = r + c·RD` (c=1.0 초기값).
  불확실성이 큰(덜 검증된) 모델에 탐색 보너스 → 신규 모델도 기회를 얻고,
  데이터가 쌓이면 exploit로 수렴.
- 하드 제약: 프로바이더 ≥ 2 (단일 프로바이더 팀 금지 — 기존 `provider_diversity_low` 경고를 제약으로 승격),
  쿨다운 모델 제외.
- `--models` 실명 지정은 **탈출구로 유지**(디버깅·테스트·강제 지정). 단 이 경우에도 출력은 익명.

### D2. 익명화: stdout 경계에서 차단

- **stdout JSON에서 모델 실명 전면 제거**: `responses[].model` → `worker` (`"A"`, `"B"`...),
  `modelsUsed` → `teamSize`, `modelSwaps[].original/replacement` → 익명 라벨 유지 + 프로바이더도 숨김.
- 라벨은 런 내 고정, 런 간 무의미(브랜드 추적 차단을 위해 셔플).
- **실명 매핑은 debug 캡처에만** 저장(`.pyreez/debug/<id>/`) — 사람 전용. 호스트 스킬에
  "debug 디렉토리를 읽지 마라"를 명시(강제는 불가능, 규약).
- `interrogate`는 이미 `--round N --worker I` 좌표로 동작 → 익명과 호환, 변경 불요.
- ratings 파일은 실명 키(내부 전용). `pyreez ratings` 커맨드는 사람 진단용으로 실명 출력.

### D3. 채점: 절대점수 폐기, 쌍대비교로 교체

- **매 심의 종료 후 기본 ON** (`--no-scoring` 옵트아웃). 실패/degraded 런은 스킵.
- 최종 라운드 워커 출력들을 **쌍대비교**: judge에게 익명 A/B 쌍을 주고 "과제 기준 어느 쪽이 나은가 (A/B/tie)".
- 쌍 샘플링: n≤4 전쌍(≤6쌍), n≥5는 각 워커가 2쌍 이상 등장하도록 라운드로빈 샘플 (비용 상한 n쌍).
- 위치 편향: 쌍마다 A/B 순서 무작위.
- judge 선정: **팀에 없는 프로바이더의 모델** 우선(자기 회사 모델 편애 차단), 저비용 티어 기본.
- 도메인: `--topic` 있으면 그대로, 없으면 judge 호출에 분류를 얹는다
  (같은 호출에서 "이 과제의 도메인은?" 1계층 분류 → 추가 호출 0).

### D4. 비교 불가능 프로토콜의 증거 처리

쌍대비교는 "같은 것을 만든 출력"에만 유효하다.

| 프로토콜 | 최종 출력 성격 | 처리 |
|---|---|---|
| shared_convergence | 동질 (같은 과제의 답) | 쌍대비교 ✓ |
| adversarial_debate | 동질 | 쌍대비교 ✓ |
| evaluation_scoring | 동질 (같은 대상의 평가) | 쌍대비교 ✓ (평가의 질을 비교) |
| sequential_refinement | 체인 — 뒤 워커가 유리 | **채점 제외** (v1) |
| red_team | 생성자/공격자 비대칭 | **채점 제외** (v1) |
| host_interrogation | 서로 다른 질문의 답 | **채점 제외** (v1) |

"모든 프로토콜 갱신" 요구와의 타협: v1은 비교 가능한 3종만. 나머지는 왜곡된
데이터를 넣느니 안 넣는다. (v2 후보: 역할 기준 런-간 비교 — 미해결 질문 Q2)

### D5. 레이팅: Glicko-1, (model × domain) 단위

- 알고리즘: **Glicko-1** (Elo + 불확실성 RD + 비활동 시 RD 증가 = 시간 감쇠 내장).
  선택 이유: 온라인 갱신(런당 O(쌍)), 외부 의존성 0, 불확실성이 D1의 UCB에 직결,
  구현이 수십 줄이라 검증 가능.
- 단위: `(model, domain)` — 축(axis)별 세분화는 v1 제외 (11모델 × 도메인 × 축 = 차원 폭발,
  축적 0건에서 시작하는 시스템에 과분화는 독).
- 도메인 백오프: 해당 도메인 노드의 n이 얇으면 부모 도메인 → 전역 순으로
  RD 가중 블렌드(1/RD²). 신규 도메인도 즉시 동작.
- 저장: `.pyreez/ratings.json`
  ```json
  { "v": 1, "updatedAt": 0,
    "domains": { "backend/db": { "openai/gpt-5.5": { "r": 1520, "rd": 180, "n": 14, "lastTs": 0 } } } }
  ```
- 기존 affinity 자산(로그·트리·`affinity`/`affinity-compact` 커맨드) **전량 삭제** —
  축적 0건이므로 마이그레이션 없음. `pyreez ratings`로 교체.

### D6. 리스트업 주기: 24h → 1h

프로브 실측 비용: codex는 번들(네트워크 0), grok `grok models` ~1s, claude SDK sub-second.
1h TTL 동기 갱신으로 충분히 싸다. `--refresh` 강제 갱신 유지. 매 턴 프로브는
grok 네트워크 지연을 매 심의에 얹는 것이라 기각.

### D7. effort — v1 범위 제외, 공변량만 기록

effort 자동 선택은 "과제 난이도 추정"이라는 별개 문제를 끌고 온다.
v1: 런의 effort를 채점 레코드에 공변량으로 기록만 한다(회귀 분석용 데이터 축적).
v2: (model, domain, effort)별 rating 차이가 실측되면 "이 도메인은 low로 충분" 추천.

## 3. 구현 단계 (각 단계 RED→GREEN, 전체 스위트 통과 후 다음)

| P | 내용 | 파일 |
|---|------|------|
| P1 | stdout 익명화 + debug에 실명 매핑 | engine.ts(출력 조립), cli.ts, handlers.ts, transcript.ts |
| P2 | Glicko 코어 (순수 함수) + ratings 저장소 | model/ratings.ts (신규), validation/schemas.ts |
| P3 | 종료 후 쌍대비교 훅 (D3·D4) | wire.ts(기존 affinity 블록 대체), quality/pairwise-judge.ts (신규) |
| P4 | 팀 자동 선택 (D1) | wire.ts, team-composer.ts |
| P5 | TTL 1h + 도메인 자동 분류 | cli.ts, quality/pairwise-judge.ts |
| P6 | affinity 삭제, `ratings` 커맨드, CLAUDE.md의 BT 거짓 서술 수정, 호스트 스킬 갱신 | cli.ts, model/affinity.ts(삭제), CLAUDE.md, .claude/skills/ |

## 4. 테스트 계획

- Glicko: 승/패/무 갱신, RD 수축·팽창, 백오프 블렌드 — 경계값 유닛.
- 익명화: 실명이 stdout에 한 글자도 안 나가는 것을 전 커맨드 통합 테스트로 (grep 수준 검증).
- 쌍대비교: 쌍 샘플링 상한, 위치 무작위화, judge 프로바이더 회피, tie 처리.
- 선택: UCB 정렬, 다양성 제약, 쿨다운 제외, `--models` 탈출구.
- E2E: 실모델 2런 → ratings.json에 갱신 발생 → 3번째 런의 선택이 영향받는 것.

## 5. 미해결 질문 (리뷰어에게)

- Q1. judge 편향: 팀 밖 프로바이더 judge가 항상 가능한가? (4사 중 3사가 팀이면 남는 건 1사 —
  그 1사가 gemini처럼 죽어 있으면?) 폴백 순서를 어떻게?
- Q2. 비교 불가 3종 프로토콜의 증거를 버리는 게 맞나, 런-간 비교로 살릴 수 있나?
- Q3. 도메인 분류를 judge에 맡기면 분류 드리프트(같은 과제가 다른 도메인으로)가
  rating을 희석한다. 고정 taxonomy가 나은가?
- Q4. 익명 라벨을 런 간 셔플하면 사람의 사후 분석(어느 모델이 자주 이겼나)은
  debug를 뒤져야 한다. 허용 가능한 비용인가?
- Q5. UCB 탐색이 실사용 런에서 "일부러 약한 모델을 태우는" 비용을 발생시킨다.
  탐색률 c의 적정값 또는 탐색 전용 저가 런 분리?
- Q6. Glicko-1이면 충분한가, Glicko-2(변동성 σ)나 TrueSkill(팀전)이 필요한 시나리오가 있나?
