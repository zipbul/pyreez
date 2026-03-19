# Spec: Feedback 시스템 재설계

> 2026-03-19 작성. deliberation 2회 검증 완료.

## 문제

1. BT 승패 기반 → 특정 모델 반복 선택, 다양성 사망
2. 호스트가 자기 모델 계열 평가 → self-bias 10-25%
3. 모델 출력 inconsistency → 자유 텍스트 프로필 누적 불가

## 설계 원칙

1. **Binary 기반, 필요 시 Ordinal 확장**: binary가 evaluator 안정성에서 우위 (Judge Reliability Harness, 2026). 단 binary만으로는 top-tier 구분 불가 (discrimination ceiling: 2^5 = 32 프로필). 데이터로 확인 후 ordinal 도입.
2. **Absolute > Pairwise**: 승패 제거 확정. 각 모델을 독립 평가.
3. **TS production 검증됨**: SourcePilot이 TS + binary absolute scoring을 production 운영.
4. **Elo는 선택 경로에서 제거**: 분산 붕괴로 TS 탐색이 장기적으로 사망.

## 검증에서 확인된 취약점

### 1. Discrimination Ceiling (3개 워커 합의)

binary 5 dimension = 32 프로필. 모델들이 80-90% pass하면 TS가 uniform selection으로 퇴화. **나쁜 모델 제거는 되지만 좋은 모델 선택은 안 된다.**

### 2. Cheap Evaluator 비대칭 노이즈 (3개 워커 합의)

cheap evaluator가 confident hallucination을 정확으로 판정하는 방향의 systematic error. evaluator rotation은 점근적으로만 보상.

### 3. Gaming (xai/grok-4 제기, acceptance reject 후 반영)

모델이 binary를 최소한으로 통과하도록 최적화 가능. binary는 "기술적으로 통과하지만 평범한" 응답을 구분 불가.

## 설계

### Phase 1: Binary 기반 (초기 배포)

#### 피드백 신호

```typescript
interface FeedbackRecord {
  deliberation_id: string;
  model_id: string;
  domain: string;
  task_type: string;
  evaluator_id: string;  // 외부 평가자 (rotated)

  // Binary dimensions — pass(1) or fail(0)
  dimensions: {
    factually_correct: boolean;
    addresses_task: boolean;
    provides_evidence: boolean;
    novel_perspective: boolean;
    internally_consistent: boolean;
  };

  // Failure flags — 치명적 실패
  failures: {
    hallucination: boolean;
    refusal: boolean;
    off_topic: boolean;
    degenerate: boolean;
  };
}
```

#### 스코어 저장: SkillCell

```typescript
interface SkillCell {
  model_id: string;
  domain: string;
  task_type: string;

  // Per-dimension Beta parameters
  dimensions: {
    [key: string]: { alpha: number; beta: number };
  };

  // Failure counts
  failure_counts: {
    [key: string]: number;
  };

  total: number;
}
```

초기값: `alpha = 1, beta = 1`. 업데이트: pass → `alpha += 1`, fail → `beta += 1`.

#### 모델 선택: Thompson Sampling

```typescript
function selectModels(domain: string, taskType: string, pool: Model[], n: number): Model[] {
  const samples: { model: Model; score: number }[] = [];

  for (const model of pool) {
    const cell = getSkillCell(model.id, domain, taskType);
    if (shouldExclude(cell)) continue;

    let dimSum = 0;
    const dims = Object.keys(DIMENSIONS);
    for (const dim of dims) {
      const { alpha, beta } = cell?.dimensions[dim] ?? { alpha: 1, beta: 1 };
      dimSum += betaSample(alpha, beta);
    }
    samples.push({ model, score: dimSum / dims.length });
  }

  samples.sort((a, b) => b.score - a.score);
  return enforceDiversity(samples, n);
}
```

#### 회피 추천: Wilson Score

```typescript
function shouldExclude(cell: SkillCell | null): boolean {
  if (!cell || cell.total < MIN_OBS) return false;

  const { alpha, beta } = cell.dimensions.factually_correct;
  const n = alpha + beta - 2;
  if (n < MIN_OBS_FOR_EXCLUSION) return false;

  const passRate = alpha / (alpha + beta);
  const lower = wilsonLower(passRate, n, 1.96);
  return lower < EXCLUSION_THRESHOLD;
}
```

#### Cold-Start

```
Tier 1: same family + same domain → family의 alpha/beta를 inflated variance로
Tier 2: same family + any domain → 더 넓은 prior
Tier 3: 데이터 없음 → uniform (alpha=1, beta=1) + 필수 탐색 슬롯 (1/round)
```

#### 외부 평가자

- 호스트가 평가하지 않음 — self-bias 구조적 제거
- evaluator rotation — 여러 provider의 cheap model 교대 사용
- binary 판정이므로 evaluator 간 일관성 높음

### Phase 2: Ordinal 확장 (데이터 확인 후)

**도입 조건**: Phase 1 데이터에서 특정 도메인의 top-tier 모델들 pass rate가 80%+ 수렴하여 TS가 구분하지 못할 때.

**변경**: `factually_correct`와 `novel_perspective`에 3점 ordinal (weak/adequate/strong) 추가.

```typescript
interface OrdinalFeedback {
  factually_correct_grade: 'weak' | 'adequate' | 'strong';
  novel_perspective_grade: 'weak' | 'adequate' | 'strong';
}
```

TS는 binary Beta로 bottom-tier pruning 후, ordinal posterior로 top-tier 선택.

**주의**: ordinal은 binary보다 evaluator 불안정성이 높다 (Judge Reliability Harness). 도입 시 evaluator 안정성 모니터링 필수.

### Phase 3: Expensive Evaluator Escalation (선택적)

Phase 2로도 top-tier 모델 posterior가 overlap하면, expensive evaluator (Opus-class)로 해당 모델 쌍만 head-to-head 비교. 전체가 아닌 **posterior overlap 모델 쌍에만** 적용하여 비용 제한.

### BT 처리

- 선택 경로에서 **완전 제거**
- `pyreez_feedback` MCP 도구 input schema 변경: pairwise → per-model binary/ordinal
- 기존 BT 데이터 보존, 사용하지 않음
- shadow mode로 BT 계속 계산하여 새 시스템과 상관 모니터링 (선택적)

### Migration Path

```
Phase 1-A: FeedbackRecord 스키마 + external evaluator 구현
           기존 pairwise feedback 병행 (dual-write)
Phase 1-B: SkillCell + Thompson Sampling 선택
           기존 BT 선택을 TS로 교체
Phase 1-C: 회피 추천 + cold-start 로직
Phase 1-D: 기존 pairwise feedback 폐기

Phase 2:   데이터에서 top-tier 수렴 확인된 도메인에 ordinal 추가
Phase 3:   필요 시 expensive evaluator escalation
```

## 열린 이슈

- 5개 binary dimension이 최적인지 (conciseness, ethical alignment 누락 지적됨)
- evaluator prompt 구체적 설계
- MIN_OBS, MIN_OBS_FOR_EXCLUSION, EXCLUSION_THRESHOLD 수치
- 평가 빈도: 매 deliberation vs 샘플링
- gaming 감지: downstream satisfaction signal로 "binary pass지만 합성에 기여 안 하는" 모델 탐지
- evaluator rotation 시 inter-evaluator variance 모니터링 방법

## 근거

| 설계 결정 | 근거 |
|----------|------|
| Binary 기반 + ordinal 확장 | Judge Reliability Harness: binary > ordinal 안정성. Discrimination ceiling: binary만으로는 top-tier 구분 불가 (deliberation 검증) |
| TS + absolute | SourcePilot production 검증. Elo 분산 붕괴로 pairwise 대안 부적합 (deliberation 검증) |
| Elo 제거 | 분산 붕괴로 TS 탐색 장기 사망 (deliberation 1차에서 critic이 식별, 수학적으로 확인) |
| External evaluator | Self-bias 10-25% (OpenReview) |
| Wilson score | InferenceDynamics 동일 패턴, 소표본 robust |
| Evaluator rotation | Judge Reliability Harness: "no judge uniformly reliable" |
| Cheap evaluator | Judge Reliability Harness: "Llama Maverick 17B most reliable at fraction of cost" |
| Ordinal 도입 조건 | top-tier pass rate 80%+ 수렴 시에만 — 데이터 기반 결정 (reflect에서 도출) |
| Gaming 대응 | hybrid ordinal이 "technically passes but mediocre" 구분 가능 (deliberation 2차 grok-4 제기, acceptance reject 후 반영) |
