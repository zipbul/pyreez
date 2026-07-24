# 설계안 v3: 주제별 모델 강점 점수 시스템 (실측 기반)

상태: DRAFT (pyreez 심의 검토 대기)
날짜: 2026-07-15
선행: v1(3자 리뷰 기각) → v2(3자 리뷰 기각) → v3(실측 반영)

## 0. v3는 추측이 아니라 실측 위에 선다

v1·v2는 리뷰어 연역으로 기각됐다. v3는 실제 측정으로 핵심 가정을 검증한 뒤 설계한다.

### 실측 1: 모델은 주제별 강점이 다른가? → YES
6개 도메인(의학·법률·수학·화학·역사·시)에 opus·gpt-5.4·grok-4.5를 격리 응답시켜 채점.
- law: opus/grok(91) > gpt(84) — 15점 격차
- chemistry: grok≈opus > gpt (2위 교차: chem에선 grok>gpt, 타 도메인 gpt>grok)
- math: 3사 무차별(쉬운 문제)
→ 도메인별로 순위가 갈린다. 단 격차는 도메인마다 다름(law 큼, math 없음).

### 실측 2: 단일 고정 judge는 편향되는가? → YES (치명)
같은 응답을 anthropic·openai·xai judge 3사로 교차 채점:
- law 승자: {opus, opus, **grok**} — judge마다 바뀜
- chemistry 승자: {opus, **grok**, opus}
- math 승자: {**grok**, opus, **grok**}
- self-preference 실증: grok judge가 grok에 law 99점(타 judge 84·92)
→ **단일 고정 judge는 self-preference로 순위를 뒤집는다.** v2의 "고정 judge"는 실측으로 기각.
→ 다중 judge 평균 시 편향 상쇄되고 진짜 신호(gpt 일관 하위) 잔존.

### 실측 3: 도메인 레벨로 충분한가, 하위 주제까지 필요한가? → 하위 주제 필요
medicine 도메인 안에서 하위 주제 3개를 다중 judge 평균으로 측정:
- diagnosis: gpt≈grok > opus
- pharmacology: opus > grok > gpt
- interpretation: opus > grok > gpt
→ **같은 도메인 안에서 하위 주제마다 강점 모델이 뒤집힌다.** "medicine=opus" 도메인 라벨은 틀림.
→ 단 하위 주제 점수차가 1~3점으로 약함. 셀당 샘플이 충분해야만 노이즈에서 분리됨.

### 실측이 확정한 3대 설계 결정
1. **다중 judge 필수** (단일 고정 judge는 편향으로 순위 뒤집음 — 실측 2).
2. **하위 주제까지 세분화** (도메인 레벨은 강점 교차를 놓침 — 실측 3).
3. **적응적 깊이** (세분화 신호가 1~3점으로 약해 셀 샘플 밀도가 깊이를 제한 — 실측 3).

## 1. 목표

호스트가 새 심의를 시작할 때, pyreez가 "이 주제엔 이 모델 조합이 강하다"를 학습된 점수로
제안한다. 대상은 인간 지식 전 분야(개발 아님). 강점은 (모델 × 주제경로) 단위로 축적한다.

## 2. 채점 (실측 2 반영)

### D-A1. 다중 judge 합의
- 매 심의 종료 후, 최종 라운드 각 워커 출력을 **팀에 없는 provider의 judge 전원**으로 채점.
  3 provider(openai/xai/anthropic) 중 팀이 안 쓴 provider들이 judge. 각 judge 점수의 **중앙값**
  (평균 아님 — 이상치 judge 1명에 강건)으로 셀 점수 확정.
- 팀이 3사를 다 쓰면 중립 judge 0 → **그 런은 채점 스킵**(`scoring_skipped: no_neutral_judge` 기록).
  실측 2가 보인 편향을 감수하느니 안 넣는다.
- 워커 독립 채점(각 출력 따로) + 다중 judge 중앙값. self-preference는 provider 교차로 상쇄.

### D-A2. 채점 축(axes) — 기본값 제공
- v2 결함(axes 공급원 없음) 수정: 호스트가 --axes 미지정 시 **기본 axes 3개**(correctness·
  completeness·clarity) 사용. rubric-judge에 이 기본값 하드코딩. → "기본 ON"이 실제로 작동.
- 축별 점수를 셀에 따로 저장(선택 시 task 관련 축 가중용, v2 S6 반영).

### D-A3. 채점 대상 프로토콜
- 워커 최종 출력이 존재하고 동질인 프로토콜만: shared_convergence, adversarial_debate,
  evaluation_scoring. sequential/host_interrogation/red_team은 역할·질문 교란(리뷰 합의) +
  red_team generator는 최종 라운드에 없음(구조적 미채점) → **채점 제외**, `scoring_skipped: protocol` 기록.
- "모든 프로토콜"은 포기. 실측·리뷰 둘 다 3종만 유효 신호라고 지목.

## 3. 주제 분류 + 적응적 깊이 (실측 3 반영)

### D-B1. 주제경로 + 적응적 깊이
- 주제는 계층 경로: `도메인/하위주제/키워드` (예: `medicine/diagnosis/pulmonary-embolism`).
- 호스트가 `--topic "medicine/diagnosis"` 주면 그대로. 미지정 시 채점 judge가 **같은 호출에서**
  고정 상위 taxonomy(도메인 ~15개) 택1 + 하위 2계층 자유 라벨 생성(드리프트는 상위 고정으로 제한).
- **적응적 깊이**: 점수는 전 계층에 누적하되, **선택 시** 리프부터 올라가며 "샘플이 신뢰 임계
  이상인 가장 깊은 계층"을 쓴다. 리프가 얇으면 부모로 백오프. 실측 3의 "신호 약함 → 밀도가 깊이 제한"을 구현.

### D-B2. 백오프가 강점 신호를 안 죽이게
- v2/리뷰 결함(백오프가 니치 강점을 부모 평균으로 희석): 백오프는 **점수 대체가 아니라 사전분포**로.
  리프 셀 = `부모 사후를 prior로 한 베이지안 갱신`. 리프에 샘플이 쌓일수록 부모에서 멀어지고,
  얇으면 부모에 가깝다. 강점 신호(리프가 부모보다 높음)가 샘플과 함께 살아난다.

## 4. 저장 (v2 톰슨 공식 오류 수정)

### D-C1. (model, topic-path, axis) → 베이지안 정규
- 저장: 각 셀에 `Normal-Normal 켤레`의 `(mean, n, M2)` (Welford). 부모→리프 prior 체인.
- 사후분산 = **`1/(n/σ² + 1/prior_var)`** (v2의 `var/n + prior_var` 오류 수정 — n↑ 시 0 수렴).
- `.pyreez/ratings.json` (affinity 삭제·교체).

## 5. 자동 선택 (옵트인)

### D-D1. `--auto-team N` 톰슨 샘플링
- --models 미지정 + --auto-team N 시: 새 쿼리의 주제경로 추정(judge 1콜 분류) → 그 셀(적응적
  깊이)에서 각 모델 사후 `Normal(mean, post_var)`에서 1샘플 → task 관련 축 가중 상위 N.
- 제약: provider ≥ 2, 서로 다른 모델(중복 슬롯 금지). N > 가용수면 clamp.
- 톰슨의 사후분산이 탐색·활용 자동 조절 → 콜드 셀은 넓게 탐색(별도 UCB 상수 불요).
- 기본은 여전히 --models 수동(탈출구).

### D-D2. 키 비대칭 완화 (리뷰 지적)
- 선택 키(사전 주제추정) ≠ 학습 키(사후 judge 라벨) 문제: 사후 라벨이 사전추정과 다르면
  **양쪽 셀 모두에 기록**(사전추정 셀엔 "라우팅이 여기로 보냈다" 메타, 사후 셀엔 실점수).
  선택 편향을 로그로 드러내 진단 가능하게. 완전 해결(오프폴리시 보정)은 v3 범위 밖, 한계로 명시.

## 6. 익명 (실측과 별개, 리뷰 합의 반영)
- 완전 익명은 셸 호스트에 불가(리뷰 합의). 목표: "기본 워크플로 브랜드 중립".
- stdout **및 stderr**(cli.ts:344) 실명 → 익명 라벨. **interrogate 출력**(cli.ts:588 `model` 필드)도
  익명화(v2가 놓친 채널). debug 캡처는 실명 유지(사람 전용, 목표 하향으로 정합).

## 7. 정직한 한계 (실측이 드러낸 것)
1. 주제 강점 점수차가 작다(도메인 15점, 하위주제 1~3점). 얇은 셀은 신호<노이즈 — 적응적 깊이로 방어하나 완전 해결 아님.
2. 다중 judge도 3 provider뿐이라 팀이 3사 쓰면 중립 judge 0 → 그 런 미채점.
3. 측정 대상은 "그 팀 구성에서의 기여"지 모델 단독 능력이 아님(리뷰 지적). 팀 변주 없이 완전 분리 불가.
4. 키 비대칭(선택≠학습) 완전 보정은 범위 밖.

## 8. 구현 단계
| P | 내용 |
|---|------|
| P1 | ratings.ts: Normal-Normal 켤레 (mean,n,M2) + prior 체인 백오프 |
| P2 | 다중 judge 중앙값 채점 + 기본 axes + 팀밖 provider judge 선정/스킵 |
| P3 | 주제 분류(상위 고정+하위 자유) + 적응적 깊이 조회 |
| P4 | --auto-team 톰슨(정규-정규 켤레) + provider≥2 + 중복금지 + 축 가중 |
| P5 | 익명 라벨 (stdout·stderr·interrogate) |
| P6 | affinity 삭제 → ratings 커맨드, CLAUDE.md BT 거짓서술 수정, 호스트 스킬 |

## 9. pyreez 심의 검토 질문
- 다중 judge 중앙값이 3 provider(judge 최대 2명)에서 이상치에 충분히 강건한가?
- 적응적 깊이의 "신뢰 임계"를 뭘로? 실측상 하위주제 신호가 1~3점인데 몇 샘플이면 분리되나?
- 베이지안 prior 체인 백오프가 실제로 니치 강점을 보존하는가, 아니면 여전히 부모로 끌리나?
- 채점 3종 제한이 나머지 3종 프로토콜 팀 선택을 영구 콜드로 두는데, 허용 가능한가?
