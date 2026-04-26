# pyreez 리서치 자료 (research corpus)

## 목적
pyreez의 호스트 질문/요청 기법, 프로토콜 설계, 워커 prompt 구조 결정의 **검증 가능한 근거**를 모은다. SKILL.md / prompts.ts / engine.ts 의 모든 비-자명 결정은 이 디렉토리의 자료를 참조해야 한다.

## 사용 방법
- 다른 에이전트(Claude Code 또는 인간)가 SKILL.md, prompts.ts, engine.ts의 변경 근거를 fact-check할 때 이 디렉토리를 참조
- 각 자료는 (1)저자/venue/년도/URL (2)논문이 직접 말한 것 인용 (3)pyreez 적용 함의 (4)한계 4섹션 구조
- preprint(arxiv only) 자료는 [preprint] 라벨, peer-reviewed venue 자료는 [peer-reviewed] 라벨

## 파일 목록

| 파일 | 내용 |
|---|---|
| [00-corpus-overview.md](./00-corpus-overview.md) | 전체 검증 corpus 13+α 리스트, peer-reviewed/preprint 분류 |
| [01-task-specification.md](./01-task-specification.md) | task 작성: failure-condition framing, false-premise 식별, layout (Lost-in-the-Middle) |
| [02-multi-agent-debate.md](./02-multi-agent-debate.md) | MAD, DoT, 14 failure modes, heterogeneity, lazy agent, persuasion attack |
| [03-confidence-calibration.md](./03-confidence-calibration.md) | Verbalized confidence (Tian 2023 → QA-Cal ICLR 2025 → DiNCo 2025 → SteerConf 2025) |
| [04-llm-as-judge.md](./04-llm-as-judge.md) | MT-Bench, G-Eval, LLM-RUBRIC, IJCNLP 2025 position bias, Anthropic 2026 RCAF |
| [05-sycophancy.md](./05-sycophancy.md) | Sharma ICLR 2024, ICLR 2026 ELEPHANT/separation, Nature 2026 persuasion, npj Medical 2025 |
| [06-persona-roles.md](./06-persona-roles.md) | Zheng EMNLP 2024 Findings (personas don't help), ChatEval ICLR 2024 (diverse roles), Heterogeneous Debate Engine 2026 |
| [07-protocol-specific.md](./07-protocol-specific.md) | 6 프로토콜별 검증 자료 (shared_convergence/adversarial_debate/host_interrogation/sequential_refinement/evaluation_scoring/red_team) |
| [08-reasoning-models-2026.md](./08-reasoning-models-2026.md) | Anthropic adaptive thinking, "step by step" 폐기, thinking.effort API |
| [09-known-gaps.md](./09-known-gaps.md) | 자료 부족 영역 정직 라벨 (어떤 결정이 추정에 의존하는지) |

## 신뢰 등급
| 등급 | 의미 | 예 |
|---|---|---|
| **[peer-reviewed]** | ACL/EMNLP/NeurIPS/ICML/ICLR/TACL/Nature/Findings 게재 확인 | Liu TACL 2024, Sharma ICLR 2024 |
| **[peer-reviewed-pending]** | 메이저 venue accept 후 proceedings 대기 또는 OpenReview accepted | ELEPHANT ICLR 2026 |
| **[preprint]** | arxiv only, peer-review 미확인 | DiNCo 2509.25532, Heterogeneous Debate Engine 2603.27404 |
| **[official-doc]** | 모델 vendor 공식 문서 (Anthropic, OpenAI, Google) | Anthropic 2026 prompting best practices |
| **[industry-report]** | LMSYS, AISI, EleutherAI 등 정량 보고서 | MT-Bench (NeurIPS 2023 D&B 게재로 [peer-reviewed]도 됨) |

각 자료에 등급 명시 필수. 등급 부재 자료는 **사용 금지**.

## 갱신 정책
- LLM 분야 6개월 단위 변화 — 본 corpus는 **2026-04-25 시점 스냅샷**
- 갱신 주기: 분기 1회 또는 메이저 venue 발표 직후 (NeurIPS, ICLR, ACL 발표 후 2주 내)
- 갱신 시 deprecated 자료는 별도 섹션 보존 (history)

## 주의
- 본 corpus는 **AI(Claude Opus 4.7)가 web search + knoldr로 수집한 결과**. 인간 도메인 전문가 review 거치지 않음.
- 인용 quote의 **원전 cross-check 권장** — quote-mining 위험 차단
- preprint는 향후 peer-review 거부될 가능성 있음 — 정기적 venue 확인 필요
