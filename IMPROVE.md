# Deliberation 품질 개선 — 문제와 추측

## 1. 테크닉이 라벨일 뿐 대화 구조를 바꾸지 않는다

### 문제

`challenge`, `defend`, `propose` 등 7개 테크닉이 존재하지만, 실제로 워커에게 전달되는 대화 구조는 테크닉과 무관하게 동일하다:

```
[system] depth instructions (steelman solitaire 포함)
[user]   host-instructions + technique 1줄 + anti-conformity + other positions 전문 + task
```

challenge든 defend든 워커가 받는 맥락이 같다. technique 인스트럭션이 1줄이라 수천 자의 다른 지시 사이에 묻힌다.

### 추측

테크닉별로 대화 구조 자체를 분기해야 한다:
- **challenge**: 상대 입장의 핵심 주장만 추출하여 "이것을 반박하라" 형태로 전달. 자기 이전 응답은 제거하거나 축소 — 자기 방어 본능을 줄인다
- **defend**: 자기에게 들어온 challenge를 명시적으로 구조화하여 "이 반론에 대응하라" 형태로 전달
- **accept**: 상대 입장 중 자기와 다른 부분만 추출하여 "이 차이에 대해 판단하라" 형태로 전달
- **probe**: 모든 입장의 공유 전제만 추출하여 "이 전제가 맞는지 의심하라" 형태로 전달

## 2. system prompt의 steelman-solitaire가 테크닉과 충돌한다

### 문제

`DEPTH_INSTRUCTIONS`가 이미 "construct the strongest possible argument against it and defend against that argument"를 포함한다. 이 지시는 모든 라운드에 동일하게 적용된다.

- challenge 라운드에서 워커는 "상대를 공격하라"(technique)와 "자기 자신을 공격하라"(system)를 동시에 받는다
- defend 라운드에서 워커는 "방어하라"(technique)와 "자기를 공격하라"(system)를 동시에 받는다

워커가 혼란하거나, 더 강한 쪽(system prompt)을 따른다.

### 추측

system prompt의 depth instructions를 테크닉에 따라 조정하거나, steelman-solitaire 부분을 테크닉이 없는 라운드(R1 propose)에만 적용한다.

## 3. challenge가 "자기 전제 재검토"를 유도하지 못한다

### 문제

challenge 인스트럭션: "Focus on identifying weaknesses, counter-examples, and errors in **these positions**."

"these positions"가 모호하다. 실제 동작에서 워커들은 "다른 입장의 약점을 지적하되 내 입장은 유지"로 해석한다. challenge 라운드에서 어떤 워커도 자기 전제를 수정하지 않았다.

### 추측

challenge를 두 단계로 분리:
1. 상대 입장의 약점 지적
2. **상대 반론 중 가장 강한 것을 수용하여 자기 입장을 수정** (이 부분이 현재 없다)

또는 `concede` 테크닉을 추가하여, challenge 후 명시적으로 "자기 입장에서 포기할 부분을 선언하라"는 단계를 넣는다.

## 4. 테크닉 종류가 부족하다기보다 조합이 제한적이다

### 문제

현재 7개: challenge, defend, accept, probe, propose, extend, transform. 빠진 것:
- **steelman**: 상대 입장을 가장 강하게 재구성 (challenge의 반대)
- **concede**: 자기 입장 중 약한 부분을 명시적으로 포기
- **reframe**: 답이 아니라 질문 자체를 재정의

그러나 종류를 늘리는 것보다, 기존 테크닉이 실제로 대화 구조에 반영되는 게 먼저다.

### 추측

`propose → steelman → challenge → concede → defend` 같은 시퀀스가 진짜 dialectic을 만들 수 있다. 하지만 각 테크닉이 대화 구조를 실제로 바꾸지 않으면 라벨만 바뀐 같은 에세이가 나온다.

## 5. 다양성의 근본 한계 — 같은 코퍼스에서 나온 모델들

### 문제

4개 프론티어 모델이 비슷한 코퍼스에서 훈련되어 같은 "균형 잡힌 답변"으로 수렴한다. 첫 번째 실행에서 3/4 모델이 사실상 동일한 결론(통제/책임)에 수렴했다.

"다양한 관점에서 답하라"를 태스크에 추가하면 일부 모델의 프레이밍이 바뀌었지만(4개 중 2개), 나머지는 안 바뀌었다.

### 추측

프롬프트로 다양성을 강제하는 데는 한계가 있다. 시도할 수 있는 것:
- **worker-instructions를 모델별로 다르게** — 현재는 모든 워커가 동일한 instructions를 받는다. 모델별로 다른 관점/제약을 줄 수 있으면 구조적 다양성이 생긴다
- **질문의 다양성** — 같은 질문을 4개 모델에 던지는 대신, 같은 주제의 서로 다른 질문을 던진다
- 하지만 이 두 가지 모두 "좋은 질문/관점을 누가 설계하는가"의 문제로 귀결된다. LLM이 설계하면 같은 문제가 반복된다

## 6. anti-conformity가 모든 테크닉에 동일하게 적용된다

### 문제

`ANTI_CONFORMITY` ("Change your position only if there is clear evidence that your own analysis is incorrect")가 `accept` 외의 모든 테크닉에 적용된다.

challenge 라운드에서는 오히려 "상대 입장에 동의하는 부분을 먼저 인정한 뒤 약점을 짚어라"가 더 효과적일 수 있다. 현재 anti-conformity는 "입장을 바꾸지 마라"로 작동하여 challenge에서도 방어 자세를 유도한다.

### 추측

anti-conformity를 테크닉별로 분기:
- challenge: "상대의 가장 강한 논점을 인정하되, 그 위에서 구체적 반례를 들어라"
- defend: 현재 anti-conformity 유지
- probe: "모든 입장의 공유 전제를 의심하라" (anti-conformity 불필요)
