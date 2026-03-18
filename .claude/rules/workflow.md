# Agentic Workflow

## Step Pool

| Step | Description |
|------|-------------|
| Classify | Categorize work into a flow → **human approval required** |
| Spec | Concretize discussion with human → human approval |
| Plan | Create implementation plan → human approval |
| Analyze | Identify impact scope, design approach (disposable, discard after implementation) |
| Test | Write failing tests (RED) |
| Implement | Write code to pass tests (GREEN) |
| Verify | Automated verification: test + typecheck. Block progression on failure |
| Validate | Match each Plan/Spec item to actual code. Read the code — don't trust test results alone |
| Commit | Logical unit of work. conventional commits |

## Flows

Every task begins with **Classify**. You propose a flow, human approves. No work starts before approval.

```
Classify(human approval)
  ├→ New Feature / Large Change:  Spec → Analyze → Plan → [Test ↔ Implement → Verify]* → Validate → Commit
  ├→ Bug Fix:                     Analyze → Test(RED) → Implement(GREEN) → Verify → Validate → Commit
  ├→ Refactoring:                 Analyze → [Implement → Verify]* → Commit
  ├→ Exploration:                 Analyze → Report
  ├→ Performance:                 Analyze(profile) → [Implement → Measure → Verify]* → Commit
  ├→ Chore:                       Implement → Verify → Commit
  └→ No match:                    Report to human, do not proceed
```

`[]*` = Autonomous loop until completion (Ralph Loop). Completion: all tests pass + typecheck passes.

## Spec Skip Condition

Spec may be skipped when the Plan document contains all of: design decisions with rationale, step-by-step implementation TODOs, impact scope (files to modify), and test plan. Otherwise, write a separate Spec and get human approval.

## Validate

<validate_procedure>
1. For each design decision in Plan/Spec, find the corresponding code (file:line) and confirm correctness.
2. Trace at least one complex execution path end-to-end through the actual code — not just "does the function exist."
3. Confirm typecheck + full test suite pass.
4. Confirm every workflow step in the current flow was executed.

Done when: all items pass. Report completion only after this.
</validate_procedure>

<example title="good validate">
Plan says "멀티홉 swap 체인에서 팀을 최종 모델로 업데이트."
→ Trace: worker-0 fails → fallback-A fails → fallback-B succeeds. Check deliberate() team update code: does it resolve to B, not A?
</example>

<example title="bad validate">
Plan says "멀티홉 swap 체인에서 팀을 최종 모델로 업데이트."
→ Check: "swappedModels map exists in engine.ts? Yes. PASS."
(This missed a bug where the map resolved to the first hop, not the final model.)
</example>

## Subagent Result Verification

Subagent output is input, not your output. Before relaying to the user, verify it yourself.

- Factual claims: cross-verify against code, official docs, or web search.
- Unverifiable claims: label as "unverified" explicitly.
- Code changes by subagent: read the actual diff and confirm it matches intent.

A subagent saying "no issues found" means one model didn't find issues — not that there are none.

## Skill Trigger Policy

Judge by the nature of the question, not surface keywords. "Tell me how to build X" and "debate how to build X" have the same nature — architecture with tradeoffs. Treat any question involving design or tradeoffs as a deliberation candidate unless the user explicitly requests a single perspective.

## Guardrails

- On scope change, rewrite Spec/Plan and get human re-approval.
- Escalate to human after 3 failures with the same approach.

## Review (applicable at any step)

| Type | When |
|------|------|
| Human Review | Classify, Spec, Plan (planning domain) |
| Automated | Verify (test/type/quality) |
| Self Review | Any step (Reflection) |

## What Not To Do

- **Don't skip Validate after Verify.** Tests passing ≠ requirements met. Interface-level checks miss bugs that only appear when you trace real execution paths.
- **Don't validate by checking "does the code exist."** Trace actual data flow. A function existing at the right line doesn't mean it processes multi-step inputs correctly.
- **Don't pass through subagent results unchecked.** Verify factual claims yourself before presenting to the user.
- **Don't let the urge to show results shortcut steps.** Report "done" only after Validate passes, present synthesis only after acceptance passes.
- **Don't state assumptions as facts.** If you can't cite a source, say "unverified."
