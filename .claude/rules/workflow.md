# Agentic Workflow

## Step Pool

| Step | Description |
|------|-------------|
| Spec | Concretize discussion with human → human approval |
| Plan | Create implementation plan → human approval |
| Analyze | Identify impact scope, design approach (disposable, discard after implementation) |
| Test | Write failing tests (RED) |
| Implement | Write code to pass tests (GREEN) |
| Verify | Automated verification: test + typecheck. Block progression on failure |
| Validate | Compare output against Plan/Spec. Semantic requirement verification |
| Commit | Logical unit of work. conventional commits |

## Flows

If no flow matches, report to human and do not proceed.

```
New Feature / Large Change:   Spec → Analyze → Plan → [Test ↔ Implement → Verify]* → Validate → Commit
Bug Fix:                      Analyze → Test(RED) → Implement(GREEN) → Verify → Validate → Commit
Refactoring:                  Analyze → [Implement → Verify]* → Commit
Exploration:                  Analyze → Report
Performance:                  Analyze(profile) → [Implement → Measure → Verify]* → Commit
Chore:                        Implement → Verify → Commit
```

`[]*` = Autonomous loop until completion (Ralph Loop). Completion: all tests pass + typecheck passes.

## Guardrails

- On scope change, rewrite Spec/Plan and get human re-approval.
- Escalate to human after 3 failures with the same approach.

## Review (applicable at any step)

| Type | When |
|------|------|
| Human Review | Spec, Plan (planning domain) |
| Automated | Verify (test/type/quality) |
| Self Review | Any step (Reflection) |
