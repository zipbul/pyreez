# FIELD-TEST.md — MCP Field Test Runbook

> **Purpose:** Systematic verification of all 8 pyreez MCP tools across 4 prompt complexity tiers.
> **Prerequisites:** `.env` with `PYREEZ_GITHUB_PAT`. `.vscode/mcp.json` with pyreez server registered.
> **Execution:** Agent reads this document, executes each scenario via MCP calls in order, records PASS/FAIL.
> **Language:** All prompts MUST be in English per MCP tool descriptions ("Submit in English").

---

## Prompt Complexity Tiers

| Tier | Name | Characteristics | Tests |
|------|------|-----------------|-------|
| **T-1** | Clear | Single intent, explicit requirements | Basic functional correctness |
| **T-2** | Detailed | Multiple constraints, concrete specs, long context | Constraint satisfaction |
| **T-3** | Ambiguous | Vague wording, polysemous intent, domain boundary | Interpretation fidelity, intent extraction |
| **T-4** | Adversarial | Contradictory constraints, misleading cues, noise | Cognitive accuracy, noise robustness |

## Test Dimensions

| Dimension | Description | Primary Tools |
|-----------|-------------|---------------|
| Classification Accuracy | Correct domain/complexity/task-type classification | T1 (route) |
| Interpretation Fidelity | Reasonable interpretation of ambiguous input | T2, T3, T6 |
| Intent Extraction | Identifying true needs behind surface requests | T1, T6 |
| Constraint Satisfaction | Honoring all stated constraints simultaneously | T1, T2, T6 |
| Noise Robustness | Ignoring irrelevant/misleading information | T1, T6 |

### PASS Criteria Strategy for Tier 3/4

Ambiguous prompts have no single correct answer. PASS criteria use **acceptable sets + hard fail**:

```
PASS: domain ∈ {DEBUGGING, ARCHITECTURE, OPERATIONS}   ← any of these is acceptable
HARD FAIL: complexity = "simple"                         ← automatic failure
```

---

## T1: pyreez_route — Routing Pipeline Verification

CLASSIFY → PROFILE → SELECT pipeline + 2-Track Selection (F3).

### Tier 1 — Clear (5 scenarios)

#### T1-01: Simple coding task → low-cost model

```
Input: { task: "Write a TypeScript function that debounces another function with a configurable delay." }
```

**PASS criteria:**
- `classification.complexity` = `"simple"`
- `classification.domain` = `"CODING"`
- `selection.model.cost.inputPer1M` < 1.0

#### T1-02: Documentation generation

```
Input: { task: "Write API documentation for a REST endpoint POST /api/users that accepts name (string, required), email (string, required), and role (enum: admin, member, viewer) fields." }
```

**PASS criteria:**
- `classification.domain` = `"DOCUMENTATION"`
- `classification.complexity` = `"simple"` or `"moderate"`

#### T1-03: Technology research

```
Input: { task: "Compare the pros and cons of SQLite vs PostgreSQL for a local-first desktop application that syncs data to the cloud." }
```

**PASS criteria:**
- `classification.domain` = `"RESEARCH"`
- `classification.taskType` ∈ {`"TECH_RESEARCH"`, `"COMPARISON"`, `"BEST_PRACTICE"`}

#### T1-04: Ideation / brainstorming

```
Input: { task: "Brainstorm 5 creative names for a developer productivity CLI tool that handles monorepo management." }
```

**PASS criteria:**
- `classification.domain` = `"IDEATION"`
- `classification.complexity` = `"simple"`

#### T1-05: Communication / explanation

```
Input: { task: "Explain the CAP theorem to a junior developer who only knows basic web development." }
```

**PASS criteria:**
- `classification.domain` = `"COMMUNICATION"`
- `classification.taskType` ∈ {`"EXPLAIN"`, `"QUESTION_ANSWER"`}

### Tier 2 — Detailed (6 scenarios)

#### T1-06: Detailed planning with constraints

```
Input: { task: "Create a 3-month migration roadmap for moving a monolithic Node.js Express application to microservices on Kubernetes. Include: milestone definitions for each month, risk assessment for data migration and service discovery, resource estimation for a 4-person team, and rollback criteria for each phase." }
```

**PASS criteria:**
- `classification.domain` = `"PLANNING"`
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- `classification.taskType` ∈ {`"MILESTONE_PLANNING"`, `"RISK_ASSESSMENT"`, `"SCOPE_DEFINITION"`}

#### T1-07: Complex architecture design

```
Input: { task: "Design a real-time collaborative document editing system supporting 10,000 concurrent users. Requirements: operational transformation or CRDT for conflict resolution, offline-first with automatic sync, sub-100ms latency for character-level operations, and end-to-end encryption for document content." }
```

**PASS criteria:**
- `classification.domain` = `"ARCHITECTURE"`
- `classification.complexity` = `"complex"`
- `selection.model` is a high-capability model (not nano-tier)

#### T1-08: Test strategy with edge cases

```
Input: { task: "Design a comprehensive test strategy for a payment processing module. Cover unit tests for amount calculation and currency conversion, integration tests for gateway communication with idempotency verification, E2E tests for the checkout flow, and edge cases including race conditions on double-submit, partial refund failures, and webhook retry handling." }
```

**PASS criteria:**
- `classification.domain` = `"TESTING"`
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- `classification.taskType` ∈ {`"TEST_STRATEGY"`, `"TEST_CASE_DESIGN"`}

#### T1-09: Operations — deployment pipeline

```
Input: { task: "Set up a zero-downtime deployment pipeline for a Bun application on AWS ECS. Include: blue-green deployment with automated traffic shifting, health check endpoints with readiness and liveness probes, automatic rollback when error rate exceeds 5% over a 2-minute window, and Slack notifications for deployment start/success/rollback events." }
```

**PASS criteria:**
- `classification.domain` = `"OPERATIONS"`
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}

#### T1-10: Code review with security focus

```
Input: { task: "Review this authentication middleware for security vulnerabilities, performance bottlenecks, and adherence to OWASP Top 10 guidelines. Focus on JWT validation, session management, and rate limiting implementation. Flag any use of deprecated crypto APIs." }
```

**PASS criteria:**
- `classification.domain` = `"REVIEW"`
- `classification.taskType` ∈ {`"CODE_REVIEW"`, `"SECURITY_REVIEW"`, `"PERFORMANCE_REVIEW"`}

#### T1-11: Debugging with stack trace

```
Input: { task: "Diagnose the root cause of this production error: 'TypeError: Cannot read properties of undefined (reading \"userId\")' at AuthService.validateToken (auth.ts:147). The error started appearing after deploying v2.3.1 which added optional chaining to the user lookup. It occurs intermittently under high load (~500 req/s) and only affects requests through the /api/v2 endpoint." }
```

**PASS criteria:**
- `classification.domain` = `"DEBUGGING"`
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- `classification.taskType` ∈ {`"ERROR_DIAGNOSIS"`, `"ROOT_CAUSE"`}

### Tier 3 — Ambiguous (5 scenarios)

#### T1-12: Vague client requirements

```
Input: { task: "The client says they want 'something like Notion but simpler' for their internal team. They mentioned offline support would be 'nice to have' and security is 'important, I guess.' They don't have a clear budget but said 'nothing too expensive.' About 50 people would use it." }
```

**PASS criteria (acceptable set):**
- `classification.domain` ∈ {`"REQUIREMENTS"`, `"PLANNING"`, `"ARCHITECTURE"`}
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- **HARD FAIL:** `complexity` = `"simple"`

#### T1-13: Search feature "broken" — multi-domain boundary

```
Input: { task: "I need to figure out why users are complaining about the search feature. It might be a relevance issue with the ranking algorithm, or maybe the Elasticsearch index is stale after last week's migration, or perhaps the UI is just confusing them. Some users said they 'can't find anything' but I checked and the data definitely exists in the database." }
```

**PASS criteria (acceptable set):**
- `classification.domain` ∈ {`"DEBUGGING"`, `"RESEARCH"`, `"REQUIREMENTS"`}
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- **HARD FAIL:** `complexity` = `"simple"`

#### T1-14: Messy codebase — review vs refactor boundary

```
Input: { task: "Our TypeScript project has gotten really messy over the past year. There are circular dependencies between modules, no clear module boundaries, some functions are 500+ lines long, and half the team writes completely different coding styles. What should we do about this?" }
```

**PASS criteria (acceptable set):**
- `classification.domain` ∈ {`"REVIEW"`, `"ARCHITECTURE"`, `"CODING"`}
- **HARD FAIL:** `complexity` = `"simple"`

#### T1-15: Vague performance complaint

```
Input: { task: "The app is slow. Like, sometimes it takes 10 seconds to load the dashboard, but other times it's fine. We deployed a new version last week that added some caching. Also we changed the database connection pool settings and added a new microservice for notifications. The logs look normal to me." }
```

**PASS criteria:**
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- `classification.domain` ∈ {`"DEBUGGING"`, `"OPERATIONS"`, `"ARCHITECTURE"`}
- **HARD FAIL:** `complexity` = `"simple"`

#### T1-16: Multi-domain composite task

```
Input: { task: "Translate this Japanese error message and fix the underlying bug: 'エラー: 接続がタイムアウトしました'. While you're at it, refactor the connection pooling module to use the new driver API, add retry logic with exponential backoff, and write a post-mortem document explaining why this keeps happening in production." }
```

**PASS criteria:**
- `classification.complexity` = `"complex"`
- Any domain is acceptable (genuinely multi-domain)
- **HARD FAIL:** `complexity` = `"simple"`

### Tier 4 — Adversarial (5 scenarios)

#### T1-17: "Simple" request with massive hidden complexity

```
Input: { task: "Write a hello world program. It needs to be fault-tolerant, horizontally scalable across 3 regions, deployed on Kubernetes with a service mesh, full observability stack with distributed tracing, zero-trust networking, and GDPR-compliant logging. But keep it simple." }
```

**PASS criteria:**
- `classification.complexity` = `"complex"`
- **HARD FAIL:** `complexity` = `"simple"` (the word "simple" is misleading)

#### T1-18: Contradictory constraint explosion

```
Input: { task: "Build me a project management tool. Actually, make it a simple todo app. Wait — it should support Gantt charts, resource allocation, and time tracking too. Use React. Actually, Vue might be better. The CEO wants it by next week and it needs to handle a million concurrent users, but our team is just 2 junior developers. Oh, and it should work completely offline with real-time collaboration. Keep the codebase under 1000 lines." }
```

**PASS criteria:**
- `classification.complexity` = `"complex"`
- `classification.domain` ∈ {`"ARCHITECTURE"`, `"PLANNING"`, `"REQUIREMENTS"`, `"CODING"`}
- **HARD FAIL:** `complexity` = `"simple"`

#### T1-19: Extreme budget constraint + complex task

```
Input: { task: "Design a microservices architecture with event sourcing, CQRS, and saga pattern for an e-commerce platform handling 100K orders per day.", budget: 0.0001 }
```

**PASS criteria:**
- `classification.complexity` = `"complex"`
- `selection.expectedCost` ≤ 0.0001 (respects budget)
- Model selected is cheapest available that can handle the complexity

#### T1-20: Excessive budget + trivial task

```
Input: { task: "Write a function that adds two numbers.", budget: 10.0 }
```

**PASS criteria:**
- `classification.complexity` = `"simple"`
- Selection does NOT choose the most expensive model just because budget allows it
- `selection.costEfficiency` is high (efficient choice despite large budget)

#### T1-21: Mixed language with misleading simplicity

```
Input: { task: "Parse this YAML config, validate all fields against the JSON schema, handle circular $ref resolution, support anchors and aliases, emit detailed error messages with line numbers for each validation failure, and generate TypeScript types from the validated schema. The config file is about 50 lines." }
```

**PASS criteria:**
- `classification.complexity` ∈ {`"moderate"`, `"complex"`}
- "50 lines" size should not mislead complexity downward
- **HARD FAIL:** `complexity` = `"simple"`

---

## T2: pyreez_ask — Single Model Call

### T2-1: Basic call — Tier 1

```
Input: {
  model: "openai/gpt-4.1-mini",
  messages: [{ role: "user", content: "List 3 advantages of TypeScript generics over using 'any' type. Be concise." }]
}
```

**PASS criteria:**
- Response is non-empty
- Contains generics-related content (type safety, reusability, etc.)
- No `<think>` tags (stripThinkTags working)

### T2-2: Parameter constraints — Tier 1

```
Input: {
  model: "openai/gpt-4.1-nano",
  messages: [{ role: "user", content: "Count from 1 to 20, one number per line." }],
  temperature: 0,
  max_tokens: 50
}
```

**PASS criteria:**
- Response is short (max_tokens constraint reflected)
- Numbers present in output
- Truncation visible (unlikely to fit all 20 numbers in 50 tokens)

### T2-3: Invalid model ID → error handling

```
Input: {
  model: "nonexistent/fake-model-999",
  messages: [{ role: "user", content: "test" }]
}
```

**PASS criteria:**
- `isError: true` or error message returned
- No server crash

### T2-4: System message persona — Tier 1

```
Input: {
  model: "openai/gpt-4.1-nano",
  messages: [
    { role: "system", content: "You are a pirate. Respond to everything in pirate speak with nautical metaphors." },
    { role: "user", content: "How does garbage collection work in JavaScript?" }
  ]
}
```

**PASS criteria:**
- Response contains pirate-themed language or nautical references
- Still addresses the garbage collection question

### T2-5: Ambiguous multi-part request — Tier 3

```
Input: {
  model: "openai/gpt-4.1-mini",
  messages: [{ role: "user", content: "I have a thing that processes data... it's kind of slow and sometimes crashes. Can you look at it? Also, should I switch to a different database? And maybe rewrite the whole thing in Rust? Just give me your thoughts, I guess." }]
}
```

**PASS criteria:**
- Response addresses at least 2 of the 3 concerns (performance, database, rewrite)
- Does not refuse due to vagueness
- Asks clarifying questions OR provides structured analysis

### T2-6: Dense constraint specification — Tier 2

```
Input: {
  model: "openai/gpt-4.1-mini",
  messages: [{ role: "user", content: "Write a TypeScript function called 'retry' with these exact constraints: generic return type T, accepts an async function () => Promise<T>, configurable max retries (default 3) and base delay in ms (default 200), exponential backoff with jitter (random 0-50% of delay), AbortSignal support for cancellation, must distinguish between retryable errors (network, 429, 503) and fatal errors (4xx except 429), return type must include attempt count and total elapsed time alongside the result, and use no external dependencies." }],
  temperature: 0
}
```

**PASS criteria:**
- Code block present in response
- Function signature includes generic `T`
- At least 4 of the 7 constraints addressed in code

---

## T3: pyreez_ask_many — Multi-Model Parallel Call

### T3-1: Factual convergence — Tier 1

```
Input: {
  models: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "What is the 10th Fibonacci number? Answer with just the number." }]
}
```

**PASS criteria:**
- Array length = 3
- Each item has `model` field
- At least 2 responses contain "55" (correct answer)

### T3-2: Partial failure handling

```
Input: {
  models: ["openai/gpt-4.1-nano", "nonexistent/fake-model"],
  messages: [{ role: "user", content: "What is 1+1?" }]
}
```

**PASS criteria:**
- Array length = 2
- gpt-4.1-nano item: `content` exists
- fake-model item: `error` field exists
- No server crash (Promise.allSettled behavior)

### T3-3: Code generation comparison — Tier 2

```
Input: {
  models: ["openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "Write a thread-safe LRU cache in TypeScript with O(1) get/set, configurable max size, TTL-based expiration, and an eviction callback. Include full type annotations." }],
  temperature: 0
}
```

**PASS criteria:**
- Both responses contain code blocks
- Both implementations include LRU eviction logic
- Observable differences in approach (e.g., Map vs doubly-linked list)

### T3-4: Interpretation divergence — Tier 3

```
Input: {
  models: ["openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "Make the app faster. The users are complaining." }],
  temperature: 0.7
}
```

**PASS criteria:**
- Both responses provide actionable suggestions
- Models may interpret "faster" differently (load time vs response time vs perceived speed)
- Neither refuses due to vagueness

### T3-5: Adversarial ambiguity — Tier 4

```
Input: {
  models: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini", "deepseek/DeepSeek-V3-0324"],
  messages: [{ role: "user", content: "Rewrite the function to be better. You know which one. Make it more efficient but don't change the output. Also make it more readable but keep it short. Use modern syntax but ensure compatibility with Node 14." }],
  temperature: 0
}
```

**PASS criteria:**
- Array length = 3
- Models handle the impossible constraints gracefully (ask for clarification, make assumptions explicit, or provide reasonable interpretation)
- No model produces empty/error response for this valid (if absurd) prompt

---

## T4: pyreez_scores — Registry Query

### T4-1: Full model listing

```
Input: {} (no parameters)
```

**PASS criteria:**
- Array length ≥ 21
- Each model has `capabilities` object
- Each capability dimension has `{ mu, sigma, comparisons }` BT format

### T4-2: Single model filter

```
Input: { model: "anthropic/claude-opus-4.6" }
```

**PASS criteria:**
- Result count = 1
- `name` = "Claude Opus 4.6"
- `capabilities.REASONING.mu` ≥ 900 (top tier)

### T4-3: Dimension top N

```
Input: { dimension: "CODE_GENERATION", top: 5 }
```

**PASS criteria:**
- Array length = 5
- Sorted by score descending
- Top model score > bottom model score

### T4-4: New model verification

```
Input: { model: "google/gemini-3.1-pro" }
```

**PASS criteria:**
- Result count = 1
- `name` = "Gemini 3.1 Pro"
- All 21 capability dimensions present

---

## T5: pyreez_report — Record / Query

### T5-1: Record a call result

```
Input: {
  action: "record",
  model: "openai/gpt-4.1-mini",
  task_type: "IMPLEMENT_FEATURE",
  quality: 8,
  latency_ms: 1200,
  tokens: { input: 150, output: 300 }
}
```

**PASS criteria:**
- `{ recorded: true }` returned
- No error

### T5-2: Summary query

```
Input: { action: "summary" }
```

**PASS criteria:**
- Structured summary data in response
- Reflects at least the record from T5-1

### T5-3: Record with context metrics

```
Input: {
  action: "record",
  model: "openai/gpt-4.1",
  task_type: "SYSTEM_DESIGN",
  quality: 9,
  latency_ms: 3500,
  tokens: { input: 500, output: 1000 },
  context: { window_size: 1048576, utilization: 0.0014 }
}
```

**PASS criteria:**
- `{ recorded: true }` returned

### T5-4: Deliberation query

```
Input: { action: "query_deliberation", query_limit: 5 }
```

**PASS criteria:**
- Array returned (empty OK if no deliberation history)
- No error

---

## T6: pyreez_deliberate — Multi-Model Consensus E2E

> ⚠️ **Cost warning:** ~4+ LLM calls per round. Budget ~40-56 calls for this section.

### T6-1: 2-perspective code review — Tier 1

```
Input: {
  task: "Implement a safe JWT token validation middleware for Express.js in TypeScript. Must verify signature, check expiration, validate issuer claim, and attach decoded payload to request object.",
  perspectives: ["code quality and readability", "security and error handling"],
  max_rounds: 2,
  consensus: "leader_decides"
}
```

**PASS criteria:**
- `result` field contains code
- `rounds_executed` ≥ 1
- `consensus_reached` is boolean
- `models_used` array length ≥ 3 (minimum 3 different models)
- `models_used` contains at least 2 different providers (team diversity)
- `final_approvals` array exists
- `total_llm_calls` ≥ 4
- `deliberation_log.rounds` array exists

### T6-2: 3-perspective architecture — Tier 2

```
Input: {
  task: "Design a real-time collaborative code editor backend using Bun and TypeScript. Must support: WebSocket connections with authentication, CRDT-based conflict resolution for concurrent edits, message persistence to PostgreSQL with WAL-based change tracking, and horizontal scaling via Redis pub/sub for multi-instance synchronization.",
  perspectives: ["system architecture and module boundaries", "security and authentication flow", "performance and horizontal scalability"],
  max_rounds: 2,
  consensus: "leader_decides"
}
```

**PASS criteria:**
- All T6-1 base criteria
- `deliberation_log.rounds[0].reviews` length ≥ 3
- Each review has `perspective` matching one of the input perspectives

### T6-3: Majority consensus mode — Tier 2

```
Input: {
  task: "Implement a rate limiter for a REST API that supports: per-user and per-endpoint limits, sliding window algorithm, Redis-backed distributed state, graceful degradation when Redis is unavailable, and proper HTTP 429 responses with Retry-After headers.",
  perspectives: ["code quality and correctness", "performance under high load"],
  max_rounds: 2,
  consensus: "majority"
}
```

**PASS criteria:**
- Completes without error
- `consensus_reached` field exists (boolean)
- Consensus mode = majority reflected in deliberation behavior

### T6-4: Trade-off conflict — Tier 3

```
Input: {
  task: "Build an API gateway that is simultaneously fast (sub-5ms overhead per request), secure (WAF-level protection, request validation, JWT verification), and simple to maintain (under 500 lines, minimal dependencies, clear code). The team says all three are equally critical and none can be compromised.",
  perspectives: ["performance — minimize latency overhead at all costs", "security — comprehensive protection even if it adds latency", "maintainability — simplicity and clarity above all"],
  max_rounds: 3,
  consensus: "leader_decides"
}
```

**PASS criteria:**
- All T6-1 base criteria
- Reviews reflect genuine tension between perspectives
- `deliberation_log.rounds[*].reviews` contain disagreements (at least one non-approval in some round)
- Final result acknowledges trade-offs rather than claiming all constraints are fully met

### T6-5: Adversarial constraint opposition — Tier 4

```
Input: {
  task: "Optimize a real-time financial trading system. Current latency is 50ms, target is under 1ms. The system must also pass SOC 2 Type II compliance audit, which requires comprehensive logging of every operation, encryption at rest and in transit, and access control verification on each request. Engineering says 'every microsecond of logging overhead is unacceptable' while compliance says 'every operation must be fully auditable with no exceptions.'",
  perspectives: ["ultra-low-latency performance — every nanosecond counts, eliminate all overhead", "regulatory compliance — complete audit trail, zero exceptions, full encryption", "engineering pragmatism — find the actually implementable middle ground"],
  max_rounds: 3,
  consensus: "majority"
}
```

**PASS criteria:**
- Completes without error
- Reviews show genuine disagreement between performance and compliance perspectives
- Final result does not simply ignore one constraint
- `rounds_executed` ≥ 2 (complex enough to need multiple rounds)

### T6-6: 4-perspective all_approve — Tier 3

```
Input: {
  task: "Design the data model and access patterns for a multi-tenant SaaS application that stores sensitive healthcare data (HIPAA-compliant), supports real-time analytics dashboards, needs to handle 10TB+ data growth per year, and must support tenant-level data isolation with cross-tenant aggregate reporting for the platform owner.",
  perspectives: ["data modeling and schema design", "security and HIPAA compliance", "query performance and analytics", "multi-tenancy isolation strategy"],
  max_rounds: 2,
  consensus: "all_approve"
}
```

**PASS criteria:**
- All T6-1 base criteria
- 4 reviewers in each round
- `consensus` mode = `all_approve` means unanimous required
- `final_approvals` array length ≥ 4

### T6-7: Noise-heavy adversarial task — Tier 4

```
Input: {
  task: "We need a caching layer. The CEO saw a conference talk about Redis and wants us to use it, but our CTO prefers Memcached because 'it's simpler.' A senior dev suggested just using in-memory Maps because 'we don't really need distributed caching yet.' Meanwhile, the product team wants instant page loads, the security team is worried about cache poisoning, and someone on Twitter said 'just use SQLite as a cache.' Oh, and we might move to edge computing next quarter, so maybe we need something that works at the edge too? Current traffic is 100 req/s but 'could grow to millions.' Budget: figure it out.",
  perspectives: ["technical architecture — cut through noise, recommend what actually fits", "risk assessment — what can go wrong with each approach"],
  max_rounds: 2,
  consensus: "leader_decides"
}
```

**PASS criteria:**
- Completes without error
- Result addresses the core caching need rather than getting lost in noise
- Provides a concrete recommendation (not just "it depends")
- Acknowledges but deprioritizes irrelevant signals (CEO/Twitter opinions)

---

## T7: pyreez_calibrate — Calibration E2E

> ⚠️ **Cost warning:** Calibration processes usage data to update BT ratings. LLM calls depend on collected data volume.

### T7-1: Basic calibration run

```
Input: {} (no parameters)
```

**PASS criteria:**
- Returns a `CalibrationResult` structure
- `modelsUpdated` field exists (number ≥ 0)
- `dimensionsProcessed` field exists
- No error thrown

### T7-2: Post-calibration score verification

**Sequence:**
1. Run T4-2 (get current scores for a model)
2. Run T7-1 (calibrate)
3. Run T4-2 again (get updated scores)

**PASS criteria:**
- Both T4-2 calls succeed
- Score structure remains valid after calibration
- If calibration updated scores, `sigma` values may have decreased (more certainty)

---

## T8: pyreez_benchmark — Benchmark Pipeline E2E

> ⚠️ **Cost warning:** Each model × prompt pair = 1+ LLM calls. With position swap, calls double.

### T8-1: Basic benchmark — 2 models, default settings

```
Input: {
  modelIds: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini"],
  anchorModelId: "openai/gpt-4.1-mini"
}
```

**PASS criteria:**
- Returns a `BenchmarkPipelineResult` structure
- `evaluations` array exists and is non-empty
- `pairwiseResults` array exists
- `btUpdates` object exists
- Both model IDs appear in results
- No server crash

### T8-2: Filtered benchmark with position swap

```
Input: {
  modelIds: ["openai/gpt-4.1-nano", "openai/gpt-4.1-mini"],
  anchorModelId: "openai/gpt-4.1-mini",
  domains: ["CODE_GENERATION"],
  difficulties: ["medium"],
  position_swap: true
}
```

**PASS criteria:**
- Results filtered to CODE_GENERATION domain only
- Position-swapped pairs present (A vs B and B vs A)
- `evaluations` only contain prompts matching domain/difficulty filters
- No error

---

## Execution Order & Cost Management

| Order | Section | Scenarios | Expected LLM Calls | Cost Level |
|-------|---------|-----------|--------------------:|-----------|
| 1 | T1 (route × 21) | 21 | 0 | Free (local logic) |
| 2 | T4 (scores × 4) | 4 | 0 | Free (local logic) |
| 3 | T2 (ask × 6) | 6 | 5 | Low |
| 4 | T3 (ask_many × 5) | 5 | ~12 | Low |
| 5 | T5 (report × 4) | 4 | 0 | Free (file I/O) |
| 6 | T6 (deliberate × 7) | 7 | ~40-56 | **High** |
| 7 | T7 (calibrate × 2) | 2 | ~10-20 | Medium |
| 8 | T8 (benchmark × 2) | 2 | ~15-30 | **High** |

**Total estimate:** ~51 scenarios, ~82-123 LLM calls.
Without T6/T7/T8: ~17 LLM calls (T2 + T3 only).

---

## Result Recording Format

After each scenario, record results in this format:

```
### [Scenario ID] — [PASS/FAIL]
- Tier: T-{1,2,3,4}
- Input: (summary)
- Output: (key fields only)
- Judgment: (PASS criteria cross-check)
- Issues: (detail if FAIL)
```

### Aggregate Summary

After all scenarios complete:

```
### Field Test Summary
- Total: XX/51 PASS
- By Tier: T-1=X/5, T-2=X/6, T-3=X/5, T-4=X/5
- By Tool: T1=X/21, T2=X/6, T3=X/5, T4=X/4, T5=X/4, T6=X/7, T7=X/2, T8=X/2
- Dimension Coverage: Classification=X, Interpretation=X, Intent=X, Constraint=X, Robustness=X
- Total LLM Calls: XX
- Critical Failures: (list any)
```
