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
| Validate | Compare output against Plan/Spec. Semantic requirement verification |
| Commit | Logical unit of work. conventional commits |

## Flows

Every task begins with **Classify**. Agent proposes a flow, human approves. No work starts before approval.

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

## Guardrails

- On scope change, rewrite Spec/Plan and get human re-approval.
- Escalate to human after 3 failures with the same approach.

## Review (applicable at any step)

| Type | When |
|------|------|
| Human Review | Classify, Spec, Plan (planning domain) |
| Automated | Verify (test/type/quality) |
| Self Review | Any step (Reflection) |
