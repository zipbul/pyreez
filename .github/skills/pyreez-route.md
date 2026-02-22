---
name: pyreez-route
description: pyreez MCP 서버의 라우팅 도구를 활용하여 태스크에 최적인 LLM 모델을 선택하는 방법. 18개 이종 모델 × 21차원 능력치 기반 적응형 라우팅.
version: 1.0.0
globs: ["**"]
---

# pyreez Route — 최적 모델 라우팅

## Overview

pyreez는 이종 모델 합의 인프라(Heterogeneous Model Deliberation Infrastructure)의 MCP 서버다. `pyreez_route` 도구는 태스크 설명을 분석하여 18개 모델 중 최적 모델을 선택한다.

## 사용 가능한 MCP 도구

### pyreez_route

태스크 설명 → 최적 모델 선택. 내부적으로 CLASSIFY → PROFILE → SELECT 3단계 파이프라인을 실행한다.

**입력:**
- `task` (string, required): 태스크 설명 (무엇을 해야 하는지)

**출력:**
- `model`: 선택된 모델 ID
- `reasoning`: 선택 근거
- `alternatives`: 대안 모델 목록

**사용 예시:**
```
pyreez_route({ task: "React 컴포넌트의 메모리 누수를 디버깅해줘" })
→ { model: "deepseek-r1", reasoning: "디버깅 + 논리 추론에 최적", ... }
```

### pyreez_ask

선택된 모델에 단일 LLM 호출. 간단한 작업에 적합.

**입력:**
- `model` (string, required): 모델 ID
- `prompt` (string, required): 프롬프트

### pyreez_ask_many

여러 모델에 동시 호출. 접근법 비교에 적합.

**입력:**
- `models` (string[], required): 모델 ID 배열
- `prompt` (string, required): 프롬프트

### pyreez_scores

모델 성능 데이터 조회/갱신.

### pyreez_report

호출 결과 기록/조회 (stigmergic memory).

## 모델 선택 기준

pyreez는 다음 21차원 능력치 프로필로 모델을 평가한다:

- **Core:** reasoning, coding, math, creativity, instruction-following
- **Language:** multilingual, korean-proficiency
- **Code:** code-completion, debugging, refactoring, architecture-design, test-generation
- **Quality:** accuracy, consistency, safety, verbosity-control
- **Performance:** speed, cost-efficiency, context-utilization, tool-use, multimodal

## 언제 pyreez_route를 사용하는가

| 상황 | 추천 도구 |
|------|----------|
| 어떤 모델을 써야 할지 모를 때 | `pyreez_route` |
| 간단한 질문/변환 | `pyreez_ask` (route 결과 모델로) |
| 다중 관점 비교 | `pyreez_ask_many` |
| 품질이 중요한 작업 | `pyreez_deliberate` (별도 Skill 참조) |
