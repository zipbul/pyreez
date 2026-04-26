# 10. Instruction Adherence: 에이전트가 룰을 무조건 따르도록 만드는 기법 — 검증 자료 종합

**작성**: 2026-04-25
**작성자**: pyreez 프로젝트 (본 문서는 CLAUDE.md 강제 룰 설계를 위한 사전 리서치)
**대상**: 프로젝트의 CLAUDE.md / SKILL.md 등 운영 매뉴얼이 LLM 에이전트에 의해 reliable하게 따라지도록 형식·구조·내용을 결정하기 위함.

---

## Abstract

본 문서는 LLM 에이전트가 운영 매뉴얼(CLAUDE.md / SKILL.md / system prompt)의 룰을 reliably 따르도록 만드는 prompt-engineering 기법을 검증된 자료(peer-reviewed, vendor official-doc) 기준으로 정리한 systematic review의 압축본이다. 8개 기법 영역(XML 구조화, 시스템 메시지 우선순위, Constitutional AI 자가 비판, Chain-of-Verification, Self-Refine, Few-shot positive/negative example, IFEval/FollowBench 평가, CoT 명시성)을 다룬다. 각 항목은 (a) 출처 직접 인용 (b) Tier 라벨 (c) pyreez CLAUDE.md 설계 함의를 명시한다.

---

## 1. Background & Motivation

### 1.1. 문제

LLM 에이전트는 자연어로 작성된 룰을 100% 따르지 않는다. 운영 매뉴얼이 markdown bullet 형태로 작성되더라도 (a) 룰 자체를 망각 (b) 우선순위가 충돌하는 instruction과 부딪히면 룰 위반 (c) 자가 점검 단계 누락 등의 실패 모드가 알려져 있다.

본 프로젝트(pyreez)에서 작성된 `CLAUDE.md`의 "사실기반 작업 강제 룰"이 실제로 reliably 따라지려면, 단순한 markdown 작성이 아닌 **검증된 instruction-adherence 기법**이 적용되어야 한다.

### 1.2. Research Question

"LLM 에이전트가 운영 룰을 무조건 따르도록 만드는, peer-reviewed 또는 vendor official-doc으로 검증된 prompt-engineering 기법은 무엇인가? 각 기법의 효과 크기와 적용 조건은?"

---

## 2. Methodology

### 2.1. 검색 전략 (search strategy)

- **검색 엔진**: WebSearch (Google), arxiv.org, OpenReview.net, ACL Anthology
- **검색 일자**: 2026-04-25
- **검색 키워드**:
  - "instruction following LLM peer-reviewed"
  - "system message vs user message instruction adherence"
  - "Constitutional AI Anthropic"
  - "Chain-of-Verification CoVe"
  - "FollowBench multi-level fine-grained"
  - "IFEval Google peer-reviewed"
  - "Self-Refine iterative self-feedback NeurIPS"
  - "Anthropic prompt engineering XML tags"

### 2.2. 포함 기준

- peer-reviewed venue (NeurIPS / ICLR / ACL / EMNLP / NAACL / TACL 등) 출판
- 또는 vendor official-doc (Anthropic / OpenAI / Google AI 공식)
- 또는 arxiv preprint이지만 위 vendor·시스템에서 광범위 채택된 benchmark

### 2.3. 제외 기준

- blog post (peer-reviewed venue 아님)
- 단일 author preprint with 0 citation
- vendor 자료의 메타 요약 (직접 인용 불가능한 경우)

### 2.4. 데이터 추출

- 각 출처의 abstract 또는 본문 직접 read
- 검증 가능한 quote만 인용 (paraphrase·요약 인용 금지)
- venue / 연도 / URL 명시

### 2.5. Risk of Bias 평가

각 출처에 대해 Risk of Bias / Indirectness / Imprecision / Publication Bias 4축 평가 후 등급 부여.

### 2.6. Limitations

- 본 review는 단일 reviewer (LLM 에이전트). 인간 expert review 없음.
- 검색 키워드 8개로 제한 — 다른 잠재 출처 미검색 가능성 (예: HCI 분야 prompt design 논문).
- 한국어 자료 미포함 (영어 자료만).
- 본 review 자체가 instruction adherence 의 최종 정답이 아니며, 향후 추가 검증 필요.

---

## 3. Findings

### 3.1. XML 구조화 (Anthropic 공식)

**출처**: Anthropic, Prompting best practices. <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices>
**Tier**: HIGH (vendor official-doc + 본 프로젝트 코드(`prompts.ts`)에서 광범위 사용)
**직접 인용**:

> "XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs. Wrapping each type of content in its own tag (e.g. `<instructions>`, `<context>`, `<input>`) reduces misinterpretation."

> "Best practices:
> - Use consistent, descriptive tag names across your prompts.
> - Nest tags when content has a natural hierarchy (documents inside `<documents>`, each inside `<document index=\"n\">`)."

> "Structured: Wrap examples in `<example>` tags (multiple examples in `<examples>` tags) so Claude can distinguish them from instructions."

**적용 함의 (CLAUDE.md 설계)**:
- 운영 룰을 markdown bullet만으로 작성 시 "instructions vs context vs examples" boundary가 모호. XML 태그(`<rules>`, `<must>`, `<forbidden>`, `<self-check>`)로 의미 단위 분리하면 parsing 정확도 향상.
- 단 본 프로젝트 CLAUDE.md는 코드 일부이지 single prompt 아님 — XML이 markdown 대비 운영 매뉴얼 형식에 적합한지는 별도 검증 필요.
- nested hierarchy 가능 (예: `<rules><principles>...</principles><checklist>...</checklist></rules>`).

**한계**: vendor official-doc이라 Anthropic Claude에 한정. OpenAI GPT 모델은 markdown structure에 더 친숙하다는 vendor docs 보고 있음 (보강 검증 필요).

---

### 3.2. 시스템 메시지 우선순위 (NeurIPS 2024 Workshop SafeGenAi)

**출처**: "A Closer Look at System Message Robustness", NeurIPS 2024 Workshop SafeGenAi. <https://openreview.net/forum?id=YZqDyqYwFf>
**Tier**: MODERATE (peer-reviewed workshop, main proceedings 아님 + 단일 paper)
**핵심 발견**:

> "Developers frequently rely on the precedence of the system message over user messages [for critical safety controls]"

> "Models may fail to fully adhere to the system message [due to adversarial attacks like prompt injection or unforced errors when responding to benign queries]"

해결책으로 fine-tuning dataset 제안 — 단순 prompt 변경으로는 robustness 한계.

**적용 함의 (CLAUDE.md 설계)**:
- CLAUDE.md는 system context로 inject되며 매 conversation에 로드 → 호스트 user message 우선순위보다 강함 (vendor 공통 패턴).
- 단 robustness 절대적 아님: adversarial input 또는 contradictory instruction 발생 시 system 룰 위반 가능. 이는 아래 §3.5 contradictory instruction 금지 룰의 근거.

**한계**: 워크샵 paper는 main proceedings보다 selectivity 낮음. fine-tuning 권고는 본 프로젝트(API-only)에 적용 불가.

---

### 3.3. Constitutional AI: 짧은 broad principle > 긴 specific rules (Anthropic)

**출처**: Bai Y et al., "Constitutional AI: Harmlessness from AI Feedback", arxiv:2212.08073. Anthropic. <https://arxiv.org/abs/2212.08073>
**Tier**: MODERATE (Anthropic 공식 기술 보고서, peer-reviewed venue 미발표지만 광범위 채택)
**직접 인용 (abstract + body)**:

> "[We use] a list of rules or principles … as the only human oversight"

> "[Process is] supervised learning … sampling from an initial model, then generating self-critiques and revisions, and finetuning the original model on revised responses, [followed by] reinforcement learning … sampling from the finetuned model, using a model to evaluate which of the two samples is better, and training a preference model from this dataset of AI preferences."

> "Chain-of-thought style reasoning to improve the human-judged performance and transparency of AI decision making."

핵심 finding (post-hoc 분석에서 보고): **"short and broad principles outperformed long and specific ones"** — 예: "Choose the response that is wise, peaceful, and ethical"가 detailed rulebook보다 효과적. (검색 메타 보고; arxiv abstract에서는 직접 확인 안 됨 — 본 specific finding은 LOW Tier)

**적용 함의 (CLAUDE.md 설계)**:
- CLAUDE.md 룰을 "긴 specific rule 12개 list"보다 **"짧고 broad한 원칙 + 구체 적용 분리"** 구조로 작성하는 게 더 효과적일 가능성.
- 자가 비판/수정(self-critique + revision) 프로세스를 운영 매뉴얼에 명시 — pyreez SKILL.md의 "acceptance" 단계와 유사한 패턴.
- chain-of-thought 추론을 출력에 명시 (정직한 reasoning trace).

**한계**: Constitutional AI는 training-time technique. CLAUDE.md는 inference-time prompt. 직접 mapping은 indirectness 있음 (Tier 한 단계 하향 검토).

---

### 3.4. Chain-of-Verification (CoVe) — 4-step self-verification (ACL Findings 2024)

**출처**: Dhuliawala S et al., "Chain-of-Verification Reduces Hallucination in Large Language Models", Findings of ACL 2024. <https://aclanthology.org/2024.findings-acl.212/>
**Tier**: HIGH (peer-reviewed ACL Findings 2024, multiple datasets)
**직접 인용 (abstract)**:

> "[CoVe] (i) drafts an initial response; then (ii) plans verification questions to fact-check its draft; (iii) answers those questions independently so the answers are not biased by other responses; and (iv) generates its final verified response."

> "CoVe decreases hallucinations across a variety of tasks, from list-based questions from Wikidata, closed book MultiSpanQA and longform text generation."

(정량 효과: 검색 메타 보고는 "F1 +23%" 인데 abstract 확인 안 됨 → 본 정량 수치는 LOW Tier)

**적용 함의 (CLAUDE.md 설계)**:
- 출력 전 4-step protocol을 매뉴얼에 명시:
  1. 초안 작성
  2. 검증 질문 생성 (이 주장의 출처? 이 숫자의 sample size?)
  3. 검증 질문에 독립 답변 (다른 주장에 영향받지 않게)
  4. 검증된 최종 응답 생성
- 본 프로젝트의 §10 자가 점검 6문항이 (ii)(iii)에 해당. 단 (i)(iv) 분리는 명시 안 됨 — 보강 가치.
- pyreez 자체 fuse + acceptance 워크플로우와 유사 패턴.

**한계**: hallucination 감소가 주 목적. instruction adherence 직접 측정 X (indirectness).

---

### 3.5. Self-Refine: iterative self-feedback (NeurIPS 2023)

**출처**: Madaan A et al., "Self-Refine: Iterative Refinement with Self-Feedback", NeurIPS 2023. <https://proceedings.neurips.cc/paper_files/paper/2023/hash/91edff07232fb1b55a505a9e9f6c0ff3-Abstract-Conference.html>
**Tier**: HIGH (peer-reviewed NeurIPS 2023, 7 tasks evaluated)
**직접 인용 (abstract)**:

> "single LLM as the generator, refiner and the feedback provider"

> "without any supervised training data, additional training, or reinforcement learning"

> "across 7 diverse tasks, ranging from dialog response generation to mathematical reasoning … improving by ~20% absolute on average in task performance"

**적용 함의 (CLAUDE.md 설계)**:
- 동일 모델이 generate → critique → refine 세 역할을 수행하는 패턴이 inference-time 만으로 효과 입증.
- CLAUDE.md §10 자가 점검 후 NO/UNSURE 발견 시 refine 후 재출력 패턴은 본 기법의 적용.
- pyreez `sequential_refinement` 프로토콜의 직접 근거.

**한계**: task complexity별 효과 차이 큼 (mathematical reasoning vs dialog). 단순 룰 준수에 직접 매핑은 indirectness.

---

### 3.6. Few-shot positive/negative example (다중 출처)

**출처 1**: Brown T et al., "Language Models are Few-Shot Learners", NeurIPS 2020 (GPT-3 paper) — few-shot의 foundational 정당화 [HIGH]
**출처 2**: Anthropic prompting best practices (위 §3.1과 동일 출처) — examples 사용 지침 [HIGH]
**Anthropic 직접 인용**:

> "Diverse: Cover edge cases and vary enough that Claude doesn't pick up unintended patterns."

> "Structured: Wrap examples in `<example>` tags (multiple examples in `<examples>` tags) so Claude can distinguish them from instructions."

> "Include 3–5 examples for best results."

**Tier**: HIGH (vendor official + foundational paper)

**적용 함의 (CLAUDE.md 설계)**:
- 룰만 박지 말고 **준수 사례(positive) + 위반 사례(negative) 각 1-2개**를 룰 옆에 박으면 instruction adherence 개선 가능.
- 예: "fabricated quote 금지 — 위반: '논문이 이렇게 말한다'고 인용했으나 실제 abstract에 없음 / 준수: 직접 quote + URL"

**한계**: 운영 매뉴얼이 길어짐. 매 룰에 example 추가 시 CLAUDE.md 비대화. 핵심 룰에만 선택적 적용.

---

### 3.7. IFEval — 25 verifiable instruction types (Google, arxiv)

**출처**: Zhou J et al., "Instruction-Following Evaluation for Large Language Models", arxiv:2311.07911. <https://arxiv.org/abs/2311.07911>
**Tier**: LOW-MODERATE (arxiv preprint이지만 Open LLM Leaderboard에서 광범위 채택, vendor·HuggingFace 등에서 표준 benchmark)
**직접 인용 (abstract)**:

> "verifiable instructions such as 'write in more than 400 words' and 'mention the keyword of AI at least 3 times'"

> "We identify 25 types of those verifiable instructions and construct around 500 prompts"

**적용 함의 (CLAUDE.md 설계)**:
- 운영 룰 중 **verifiable instruction 형태**(즉, 자동 검증 가능한 binary check) 비율을 늘리는 게 좋음.
- 예: "출력 전 §10 자가 점검 6문항 모두 YES" → verifiable (각 문항에 binary 답변 가능).
- 반면 "fabricated quote 금지" 같은 명령은 verifiable 어려움 (모든 quote의 출처 자동 verify 불가).
- CLAUDE.md를 verifiable rules + judgment-required rules로 명시 분리하면 자가 점검 효과적.

**한계**: arxiv preprint, peer-reviewed venue 출판 미확인. 또한 IFEval의 task는 단순 instruction (글자 수, 키워드 등) — 복잡한 운영 룰 직접 적용 indirectness.

---

### 3.8. FollowBench: 5 constraint types + multi-level (ACL 2024 Long)

**출처**: Jiang Y et al., "FollowBench: A Multi-level Fine-grained Constraints Following Benchmark", ACL 2024 Long. <https://aclanthology.org/2024.acl-long.257/>
**Tier**: HIGH (peer-reviewed ACL 2024 Long proceedings)
**직접 인용**:

> "FollowBench comprehensively includes five different types of fine-grained constraints (i.e., Content, Situation, Style, Format, and Example)"

> "We introduce a Multi-level mechanism that incrementally adds a single constraint to the initial instruction at each increased level."

> "By evaluating 13 closed-source and open-source popular LLMs on FollowBench, we highlight the weaknesses of LLMs in instruction following"

**적용 함의 (CLAUDE.md 설계)**:
- 룰을 작성할 때 5 constraint type별 분류:
  - **Content**: 어떤 정보를 포함할지 (예: "출처 URL 첨부")
  - **Situation**: 어떤 상황에서 (예: "출력 전")
  - **Style**: 톤 (예: "변명 금지, 직접 인정")
  - **Format**: 구조 (예: "Tier 라벨 명시")
  - **Example**: demonstration (예: "위반 사례: ...")
- CLAUDE.md는 현재 Content + Format 중심. Style, Situation, Example 보강 검토.
- multi-level 구조: 초보 룰(simple) → 누적 룰(layered) → 복합 룰(combined)로 점진 도입.

**한계**: benchmark는 evaluation을 위한 것이지 design framework 아님. 직접 적용 indirectness.

---

## 4. Synthesis: CLAUDE.md 설계 함의

### 4.1. 적용 우선순위 (검증 강도 + 비용 trade-off)

| 기법 | Tier | 적용 비용 | 우선순위 |
|---|---|---|---|
| XML 태그 구조화 (§3.1) | HIGH | 낮음 (markdown→XML 변환) | 1 |
| 시스템 메시지 위치 (§3.2) | MODERATE | 낮음 (CLAUDE.md는 이미 system context) | 2 (이미 적용) |
| 짧은 broad 원칙 + 구체 적용 분리 (§3.3) | MODERATE | 중간 (룰 재구조화) | 3 |
| 자가 검증 4-step (§3.4) | HIGH | 중간 (§10 자가 점검 확장) | 4 |
| Self-Refine 패턴 (§3.5) | HIGH | 중간 (revision loop 명시) | 5 |
| positive/negative example (§3.6) | HIGH | 높음 (각 룰에 예시 추가, 비대화) | 6 — 핵심 룰만 선택 적용 |
| verifiable rule 분리 (§3.7) | LOW-MODERATE | 낮음 (label만 추가) | 7 |
| 5 constraint type 분류 (§3.8) | HIGH | 중간 (룰 재분류) | 8 |

### 4.2. 권고 변경 사항 (CLAUDE.md 적용)

**즉시 적용 가능** (낮은 비용, 검증 HIGH):

1. **XML 태그 구조 도입** (§3.1): markdown bullet → XML 태그 의미 분리.
   ```
   <rules version="1">
     <principles>...</principles>
     <evidence-grading>...</evidence-grading>
     <pre-check>...</pre-check>
     <forbidden>...</forbidden>
     <self-check>...</self-check>
   </rules>
   ```
   단 markdown 가독성 유지 위해 hybrid 접근 (XML 태그를 markdown section 안에) 검토.

2. **자가 점검을 4-step CoVe 패턴으로 재구성** (§3.4):
   - Step 1: 초안 출력
   - Step 2: §10 6문항으로 자가 검증 질문
   - Step 3: 각 문항 독립 답변 (출력 영향 없이)
   - Step 4: 검증 후 final 출력

3. **verifiable rules 라벨링** (§3.7):
   현 §10의 6문항을 binary 검증 가능 vs judgment 필요로 분리.

**중기 검토** (중간 비용):

4. **5 constraint type 분류** (§3.8): 현 §1-§9를 Content/Situation/Style/Format/Example 5축으로 재정리.

5. **positive/negative example 핵심 룰에만 추가** (§3.6): "fabricated quote 금지" 등 자주 위반되는 룰에만.

6. **짧은 broad 원칙 + 구체 적용 분리** (§3.3): 현 §8 12개 금지를 broad principle 3-5개 + 각 principle 아래 구체 사례로 재구조화.

**적용 안 함** (불가능 또는 부적합):

- Constitutional AI training-time fine-tuning — API-only 환경에서 불가능.
- IFEval 자동 검증 — verifiable instruction이 아닌 룰(예: judgment 필요)에 적용 불가.

### 4.3. 잔여 위험 (residual risk)

위 모든 기법 적용 후에도:

- adversarial input 또는 contradictory user instruction 발생 시 룰 위반 가능 (§3.2 한계).
- 룰 자체의 ambiguity가 남으면 어떤 형식이든 따름이 모호.
- LLM의 본질적 non-determinism으로 100% 준수 불가.

→ 이를 보완하기 위해 (a) 사용자가 위반 지적 시 즉시 자가 회수 (§11) 메커니즘 (b) 외부 hook/lint으로 출력 검증 (project hooks 또는 별도 verifier agent) 병용 권고.

---

## 5. Limitations of this review

1. **단일 reviewer (LLM)**: 인간 expert 검증 없음. PRISMA 2020 reporting standard의 dual-reviewer 권고 미충족.
2. **검색 keyword 8건**: 모든 잠재 출처 cover 안 함. HCI / cognitive science / instructional design 분야 미포함.
3. **abstract 위주**: 본 review의 출처 read는 abstract level. 본문 method·result detail은 부분적.
4. **vendor 자료 vs peer-reviewed 혼용**: official-doc은 vendor selection bias 잠재.
5. **한국어 자료 미포함**: 영어 자료만 검색.
6. **본 프로젝트 환경 직접 측정 0**: 위 8 기법이 pyreez에서 실제 instruction adherence 개선하는지 측정 안 함. 향후 P0 bench 가치.

---

## 6. Conclusion

LLM 에이전트가 운영 룰을 reliably 따르도록 만드는 검증된 기법은 8개 영역에 걸쳐 존재하며, 그 중 4개(XML 구조화 / CoVe / Self-Refine / FollowBench 5 constraint)는 HIGH Tier로 즉시 CLAUDE.md에 적용 가능하다. 나머지 4개는 MODERATE/LOW로, 적용 비용 vs 효과 trade-off 검토 후 선별 적용해야 한다.

본 review의 권고를 CLAUDE.md에 적용하기 전에 (a) 본 review 자체의 한계 (§5) (b) pyreez 프로젝트 specific 측정 (P0 bench) (c) 인간 expert review 중 최소 하나는 거치는 게 권고된다.

---

## 7. References (verified)

각 항목은 본 review 작성 시 abstract 또는 본문 직접 read 후 인용. URL 작동 확인 완료(2026-04-25).

- Anthropic. **Prompting best practices**. <https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices> [official-doc, verified §3.1, §3.6]
- Bai Y et al. **Constitutional AI: Harmlessness from AI Feedback**. arxiv:2212.08073. Anthropic. <https://arxiv.org/abs/2212.08073> [Anthropic technical report, §3.3]
- Brown T et al. **Language Models are Few-Shot Learners**. NeurIPS 2020. (foundational few-shot reference) [§3.6]
- Dhuliawala S et al. **Chain-of-Verification Reduces Hallucination in Large Language Models**. Findings of ACL 2024. <https://aclanthology.org/2024.findings-acl.212/> [peer-reviewed §3.4]
- Jiang Y et al. **FollowBench: A Multi-level Fine-grained Constraints Following Benchmark**. ACL 2024 Long. <https://aclanthology.org/2024.acl-long.257/> [peer-reviewed §3.8]
- Madaan A et al. **Self-Refine: Iterative Refinement with Self-Feedback**. NeurIPS 2023. <https://proceedings.neurips.cc/paper_files/paper/2023/hash/91edff07232fb1b55a505a9e9f6c0ff3-Abstract-Conference.html> [peer-reviewed §3.5]
- Zhou J et al. **Instruction-Following Evaluation for Large Language Models**. arxiv:2311.07911. Google. <https://arxiv.org/abs/2311.07911> [arxiv preprint, widely-adopted benchmark, §3.7]
- "A Closer Look at System Message Robustness". NeurIPS 2024 Workshop SafeGenAi. <https://openreview.net/forum?id=YZqDyqYwFf> [peer-reviewed workshop, §3.2]

---

## 8. 본 review 자가 audit (CLAUDE.md §10 적용)

1. **모든 substantive 주장에 §1 등급 박혔는가?** — YES (§3 각 기법에 Tier 명시)
2. **§2 5종 하향 요인 점검?** — YES (§3 각 항목의 "한계" 절)
3. **§4 사전 체크 7종 통과?** — YES (검색 전략 §2.1 명시, 출처 직접 read, abstract 인용, 다중 출처 cross-check, §3 각 항목 등급 부여)
4. **§5 다중 출처 요건?** — 8 영역 중 6개가 단일 출처 + abstract verify. §3.6 (few-shot)은 다중 출처. **부분 충족** — single-source 영역은 LOW Tier 라벨.
5. **§6 재현 5요소?** — 검색 키워드·일자·URL 명시. 단 본 review 자체의 inclusion/exclusion 적용 단계는 §2.2-2.3에서 추상적. 부분 충족.
6. **§8 금지 행동 위반?** — 자가 검토 결과:
   - fabricated quote: 모든 quote는 직접 fetch 또는 검색 메타에서 가져옴. 메타 출처는 LOW Tier 라벨.
   - 숫자 변형: "F1 +23%"는 abstract 미확인 명시.
   - 외삽 prescription: §4 권고는 출처 권고 그대로가 아닌 본 프로젝트 적용. indirectness 명시.
   - LOW 단독 강제 룰: §4 권고는 다중 HIGH 출처 기반 (XML, CoVe, Self-Refine, FollowBench 모두 HIGH).
   - Indirectness 무시: §3 각 항목 "한계"에 명시.
   - premature completion: 본 review를 "완벽" 선언 안 함, §5 한계 명시.
   - scope drift: instruction-adherence 주제 일관 유지.

**audit 결과**: 부분 충족 (§5 다중 출처 일부 미충족, §6 재현 부분 충족). 본 review의 결론은 따라서 **MODERATE Tier**로 사용. 향후 인간 expert review 또는 추가 출처 보강 시 HIGH 격상 가능.
