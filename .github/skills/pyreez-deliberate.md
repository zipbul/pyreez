---
name: pyreez-deliberate
description: pyreez MCP 서버의 합의 기반 숙의(Deliberation) 도구. 이종 모델 팀이 생산-리뷰-합의 과정을 거쳐 단일 모델이 도달할 수 없는 품질을 달성한다.
version: 1.0.0
globs: ["**"]
---

# pyreez Deliberate — 이종 모델 합의 기반 숙의

## Overview

`pyreez_deliberate`는 **서로 다른 아키텍처의 LLM들이 구조화된 프로세스를 통해 합의에 도달**하는 도구다. Producer가 생산하고, 다른 아키텍처의 Reviewer들이 병렬로 리뷰하고, Leader가 합의를 판단하는 다라운드 프로세스.

핵심 가치: **같은 모델에 역할을 연기시키는 것이 아니라, 아키텍처가 다른 모델(GPT, DeepSeek, Llama, Mistral 등)의 본질적 사고 다양성을 교차**시킨다.

## 언제 사용하는가

| 상황 | 추천 |
|------|------|
| 간단한 질문/변환 | `pyreez_ask` 사용 |
| 다중 모델 비교 | `pyreez_ask_many` 사용 |
| **프로덕션 코드 생성** | ✅ `pyreez_deliberate` |
| **아키텍처 설계** | ✅ `pyreez_deliberate` |
| **보안 검토** | ✅ `pyreez_deliberate` |
| **복잡한 리팩토링** | ✅ `pyreez_deliberate` |

## MCP 도구: pyreez_deliberate

**입력:**

```typescript
{
  task: string;                    // 작업 설명
  perspectives: string[];          // 리뷰 관점 (최소 2개)
  // 예: ["코드 품질 + 가독성", "보안 + 에러 핸들링", "성능 + 최적화"]

  producer_instructions?: string;  // 생산자 추가 지시
  leader_instructions?: string;    // 리더 판단 기준

  team?: {                         // 미지정 시 자동 구성 (다양성 보장)
    producer?: string;
    reviewers?: string[];
    leader?: string;
  };

  max_rounds?: number;             // 기본 3
  consensus?: "all_approve" | "majority" | "leader_decides";
  initial_candidates?: number;     // Best-of-N (기본 1 = 스킵)
  include_history?: boolean;       // stigmergic memory 참조 (기본 true)
}
```

**출력:**

```typescript
{
  result: string;                  // 최종 합의 산출물
  rounds_executed: number;
  consensus_reached: boolean;
  final_approvals: Array<{
    model: string;
    approved: boolean;
    remaining_issues: string[];
  }>;
  deliberation_log: SharedContext; // 전체 숙의 이력
  total_tokens: number;
  total_llm_calls: number;
  models_used: string[];
}
```

## 프로세스 흐름

```
Round 1: 초기 생산 + 독립 리뷰
  Producer(모델A) → 산출물
  Reviewer(모델B) ─(병렬)─→ 피드백 (관점 1)
  Reviewer(모델C) ─(병렬)─→ 피드백 (관점 2)
  Leader(모델D) → 종합 → "continue" + action items

Round 2: 정보 공유 기반 수정
  Producer → 수정된 산출물 (피드백 반영)
  Reviewer ─(병렬)─→ 재리뷰 (전체 이력 참조)
  Leader → "approve" / "continue"

...반복 (최대 max_rounds)...
```

## 팀 다양성 보장

pyreez는 자동으로 **서로 다른 아키텍처**의 모델을 팀에 배치한다:

- Producer: 작업 유형 최고 점수 모델 (Provider A)
- Reviewer 1: Producer와 다른 provider (Provider B)
- Reviewer 2: 위와 다른 provider (Provider C)
- Leader: reasoning 최고 + 다른 provider (Provider D)

최소 3개의 서로 다른 provider/architecture가 한 팀에 참여.

## 사용 예시

```
pyreez_deliberate({
  task: "TypeScript로 이벤트 소싱 패턴의 aggregate root를 구현해줘",
  perspectives: [
    "타입 안전성 + DDD 패턴 준수",
    "에러 핸들링 + 엣지 케이스",
    "성능 + 메모리 효율"
  ],
  max_rounds: 3
})
```

## 비용 참고

- 라운드당 LLM 호출: 4회 (1 Producer + 2 Reviewer 병렬 + 1 Leader)
- 3라운드 기준: 12회 LLM 호출
- 대부분의 태스크는 2-3라운드에서 합의 도달 (Du et al., 2023)
