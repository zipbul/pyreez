# DSPy — 심층 분석 보고서

> 서비스 카탈로그: [docs/services.md](../services.md)

## 기본 정보

| 항목 | 내용 |
|---|---|
| **이름** | DSPy (Declarative Self-improving Python) |
| **주체** | Stanford NLP (Omar Khattab 등) |
| **GitHub** | `stanfordnlp/dspy` — ★ 32.4k |
| **URL** | dspy.ai |
| **라이선스** | MIT |
| **언어** | Python |
| **슬로건** | "Programming—not prompting—language models" |
| **기여자** | 250+ |

---

## 아키텍처 및 알고리즘

### 핵심 철학

DSPy의 핵심 주장: **프롬프트 엔지니어링은 소프트웨어 엔지니어링이 아니다.** 자연어 프롬프트를 수작업으로 조정하는 대신, 프로그래밍 언어의 추상화(모듈, 시그니처, 옵티마이저)로 LLM을 제어해야 한다.

### 3대 핵심 구성요소

#### 1. Signatures (시그니처)

"무엇을 하는가"를 선언적으로 정의 (어떻게는 DSPy가 결정):

```python
import dspy

# 간단한 시그니처
classify = dspy.Predict("sentence -> sentiment: bool")

# 상세한 시그니처
class ExtractInfo(dspy.Signature):
    """Extract structured information from text."""
    text: str = dspy.InputField(desc="Source document text")
    title: str = dspy.OutputField(desc="Document title")
    entities: list[str] = dspy.OutputField(desc="Named entities found")
    summary: str = dspy.OutputField(desc="Brief summary")
```

- 입력(`InputField`) → 출력(`OutputField`) 형식으로 태스크 정의
- 프롬프트가 아닌 **입출력 사양**
- DSPy가 시그니처를 기반으로 실제 프롬프트를 자동 생성/최적화

#### 2. Modules (모듈)

"어떤 추론 패턴을 사용하는가":

| 모듈 | 설명 | 사용 시나리오 |
|---|---|---|
| `dspy.Predict` | 단순 입력→출력 | 분류, 추출 |
| `dspy.ChainOfThought` | 사고 과정 포함 | 추론, 분석 |
| `dspy.ProgramOfThought` | 코드 생성→실행 | 수학, 계산 |
| `dspy.ReAct` | 추론+행동 루프 | 도구 사용, 검색 |
| `dspy.MultiChainComparison` | 여러 체인 비교 | 품질 최대화 |
| `dspy.Refine` | 반복 개선 | 복잡한 출력 |

```python
class RAGModule(dspy.Module):
    def __init__(self):
        self.retrieve = dspy.Retrieve(k=5)
        self.generate = dspy.ChainOfThought("context, question -> answer")

    def forward(self, question: str):
        context = self.retrieve(question)
        return self.generate(context=context, question=question)
```

- PyTorch의 `nn.Module`과 동일한 패턴
- `forward()` 메서드에서 모듈 조합으로 복잡한 파이프라인 구성
- 중첩 가능 (모듈 안에 모듈)

#### 3. Optimizers (옵티마이저)

"어떻게 최적화하는가":

| 옵티마이저 | 알고리즘 | 특징 |
|---|---|---|
| **BootstrapRS** | Random Search + 자가 생성 데모 | 가장 기본적, 빠름 |
| **BootstrapFinetune** | 생성된 데모로 파인튜닝 | 추론 비용 → 학습 비용 전환 |
| **MIPRO** / **MIPROv2** | Multi-Instruction Proposal Optimization | 프롬프트 + 데모 동시 최적화 |
| **GEPA** | Greedy Efficient Prompt Ablation | 불필요한 프롬프트 요소 제거 |
| **COPRO** | Cooperative Prompt Optimization | 프롬프트 협력 최적화 |
| **KNN Few-Shot** | k-최근접 이웃 데모 선택 | 입력 유사도 기반 데모 선택 |

**최적화 루프**:
```python
# 학습 데이터
trainset = [
    dspy.Example(question="...", answer="...").with_inputs("question"),
    ...
]

# 메트릭 정의
def accuracy(example, prediction, trace=None):
    return example.answer == prediction.answer

# 옵티마이저 실행
optimizer = dspy.MIPROv2(metric=accuracy, auto="medium")
optimized_rag = optimizer.compile(RAGModule(), trainset=trainset)
```

1. 메트릭(metric) 정의: 성공/실패 판단 기준
2. 학습 데이터 제공: 입출력 예시
3. 옵티마이저 실행: 프롬프트, 데모, 파라미터 자동 탐색
4. 최적화된 모듈 반환: 그대로 배포 가능

### 내부 동작

```
[Signature] → [Module: ChainOfThought] → [Optimizer: MIPROv2]
     ↓                ↓                        ↓
  "입출력 정의"    "추론 패턴"           "프롬프트/데모 탐색"
                                              ↓
                                     [최적화된 프롬프트]
                                              ↓
                                     [LLM 호출 → 평가]
                                              ↓
                                     [메트릭 피드백 → 반복]
```

DSPy의 옵티마이저는 **컴파일러**에 비유된다:
- 입력: 선언적 프로그램 (시그니처 + 모듈)
- 출력: 최적화된 실행 코드 (프롬프트 + 데모)
- 과정: 체계적 탐색 + 자동 검증

---

## 기술적 특징

### "Prompting이 아닌 Programming"

전통적 접근:
```python
# 수작업 프롬프트 엔지니어링
prompt = """You are a helpful assistant. Given the following context:
{context}
Answer the question: {question}
Think step by step and provide a clear answer.
"""
```

DSPy 접근:
```python
# 선언적 프로그래밍
generate = dspy.ChainOfThought("context, question -> answer")
# 프롬프트는 DSPy가 자동 생성/최적화
```

### Assertions (자기 검증)

```python
dspy.Assert(
    len(prediction.answer) > 10,
    "Answer must be at least 10 characters"
)

dspy.Suggest(
    "specific" in prediction.answer.lower(),
    "Answer should be specific"
)
```

- `Assert`: 실패 시 재시도 (hard constraint)
- `Suggest`: 실패 시 힌트 제공 후 재시도 (soft constraint)
- 런타임 자기 검증으로 출력 품질 보장

### 모델 교체 무비용

```python
# 모델 교체 — 코드 변경 없음
dspy.configure(lm=dspy.LM("openai/gpt-4o"))
# → 또는
dspy.configure(lm=dspy.LM("anthropic/claude-sonnet-4"))
```

- 시그니처가 모델에 독립적
- 모델을 교체해도 옵티마이저가 해당 모델에 맞게 재최적화

---

## pyreez와의 비교

| 차원 | DSPy | pyreez |
|---|---|---|
| **철학** | "프롬프트 대신 프로그래밍" | "단일 모델 대신 멀티모델 숙의" |
| **최적화 대상** | 프롬프트, 데모, 파이프라인 | 모델 선택, 합의 과정 |
| **멀티모델** | ❌ (단일 모델 최적화) | ✅ (이종 모델 앙상블) |
| **숙의** | `MultiChainComparison` (제한적) | ✅ Producer→Reviewers→Leader |
| **모델 선택** | ❌ (수동 지정) | ✅ 12 도메인 자동 분류 |
| **모델 평가** | ❌ | ✅ Bradley-Terry 14차원 |
| **자동 최적화** | ✅ 핵심 (6+ 옵티마이저) | ❌ |
| **학습 데이터 필요** | ✅ (학습 예시 + 메트릭) | ❌ (사전 프로파일 기반) |
| **시그니처** | ✅ 선언적 입출력 | ❌ |
| **MCP** | ❌ | ✅ |

### 핵심 차이

DSPy는 **"하나의 모델을 최대한 잘 사용하라"**, pyreez는 **"여러 모델이 함께 더 나은 판단을 내리게 하라"**. DSPy는 프롬프트/데모 공간에서의 최적화를 자동화하고, pyreez는 모델 공간에서의 선택과 합의를 자동화한다.

흥미로운 시너지: DSPy로 최적화된 프롬프트를 pyreez의 각 모델(Producer, Reviewer, Leader)에 적용하면, 두 축(프롬프트 최적화 × 모델 앙상블)의 이점을 동시에 얻을 수 있다.

---

## 커뮤니티 반응

- **학술적 권위**: Stanford NLP 출신, 32.4k 스타. "LLM 프로그래밍의 패러다임 전환" 평가
- **"올바른 추상화"**: "프롬프트가 아닌 프로그램으로 모델을 제어하는 것이 맞다" — 소프트웨어 엔지니어링 커뮤니티의 공감
- **학습 곡선**: "DSPy 개념(시그니처, 모듈, 옵티마이저)을 이해하는 데 시간이 필요하다"
- **옵티마이저 효과**: "MIPROv2로 성능이 20-40% 향상된 사례" 보고
- **한계**: "소량 데이터로는 최적화 효과 미미", "복잡한 파이프라인에서 디버깅 어려움"
- **경쟁**: "LangChain은 파이프라인, DSPy는 최적화" — 보완 관계로 보는 시각 다수
- **비판**: "모든 것을 자동화하려는 것이 항상 최선은 아니다. 도메인 지식이 필수인 경우 수작업 프롬프트가 더 나을 수 있다"

---

## 요약

DSPy는 **"LLM 프롬프팅을 프로그래밍으로 대체하자"**는 학술적 비전의 가장 영향력 있는 구현이다. 시그니처(무엇을), 모듈(어떤 패턴으로), 옵티마이저(어떻게 최적화)의 3축 구조로 프롬프트 엔지니어링을 체계화했다. pyreez와는 최적화 축이 다르며(프롬프트 공간 vs 모델 공간), 두 시스템을 결합하면 프롬프트 최적화 × 모델 앙상블의 상승효과가 가능하다.
