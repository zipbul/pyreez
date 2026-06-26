# Harness fix plan — CLI stdin bug + gemini untrusted-directory (draft for 3-way review)

Two independent, reproduced defects surfaced during live quality measurement. Bug Fix flow
(Analyze → Test RED → Implement GREEN → Verify → Validate). Both reproduced 100%.

## BUG 1 — `deliberate --subject`/`--criteria` ignore stdin `-`

### Reproduced / root cause [FACT, code-verified]
`src/cli.ts` deliberate case passes two flags RAW:
- `:205 criteria: flags["criteria"]`
- `:206 subject: flags["subject"]`
Every other stdin-capable content flag in the CLI is wrapped in `resolveValue()` (which expands
`-` → stdin, `:37-51`): task `:190`, worker-instructions `:195`, acceptance synthesis `:221`,
rank/fuse candidates `:239/:372`, quality/convergence responses `:272/:306`, inspect deliberate `:338`.
So `--subject -` (and `--criteria -`) are taken literally as `"-"`. Impact: piped evaluation_scoring
silently scores an empty subject (3 of 4 live eval runs were pure noise, all models reported the
subject was just `-`).

### Fix
In the deliberate case, await-resolve both before building the args object:
```ts
const criteria = await resolveValue(flags["criteria"]);
const subject = await resolveValue(flags["subject"]);
...
criteria,
subject,
```
Mirror of the existing task/worker-instructions pattern. ~4 lines.

### CRITICAL correction [VERIFIED by me, reproduced] — the v1 "document the limit" claim was WRONG
v1 said the 2nd `-` "gets empty." False. Reproduced: a 2nd `resolveValue("-")` THROWS
`ReadableStream is locked` (cli.ts:42 `Bun.stdin.stream().getReader()` never `releaseLock()`), which
propagates to `main().catch()` → `process.exit(1)` = HARD CRASH. Consequences:
- The naive fix (await resolveValue for both criteria AND subject) would CRASH on `--subject - --criteria -`,
  and even on `--task -` + `--subject -` (task resolves first at :190) — a crash that does NOT exist today.
- This is a PRE-EXISTING latent bug across ALL subcommands (e.g. `rank --task - --candidates -` already
  crashes today).

### Revised fix (Part 1a — make resolveValue robust; fixes the latent crash globally)
Cache stdin once; every `-` returns the same cached payload. VERIFIED working (double `-` → both get
payload, no crash; plain/undefined pass through):
```ts
let stdinCache: Promise<string> | undefined;
function readStdinOnce(): Promise<string> {
  if (!stdinCache) stdinCache = (async () => {
    const chunks: Uint8Array[] = [];
    const reader = Bun.stdin.stream().getReader();
    try { while (true) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); } }
    finally { reader.releaseLock(); }
    return Buffer.concat(chunks).toString("utf-8").trim();
  })();
  return stdinCache;
}
// in resolveValue: if (value === "-") return readStdinOnce();
```
Semantics: one stdin source → every `-` flag receives the full piped payload (you cannot split stdin).
Document that. Strictly better than v1: fixes subject/criteria, removes the crash, repairs all subcommands.
Part 1b (wiring): still `await resolveValue` for criteria(:205)+subject(:206).

### Test strategy — DECISION NEEDED (open question 1)
There is currently NO `cli.spec.ts`/`test/cli.test.ts`; the CLI builds a real provider config
(claude/codex/gemini/xai), so it can't be unit-tested without spawning real models. Options:
- **(A) Subprocess integration test** that pipes a sentinel subject and asserts it reaches a worker.
  Needs real providers → slow/cost, network-dependent. Faithful but heavy.
- **(B) Refactor a testable seam**: extract the flag-resolution into a pure async function
  `resolveDeliberateFlags(flags, resolveValue)` returning the resolved object; unit-test it with a
  stub `resolveValue` (stdin doubled). Cheap, deterministic, guards the exact wiring bug. Mild refactor.
- **(C) Export `resolveValue` + unit-test it** only. Rejected: tests the already-working function,
  NOT the wiring bug (the bug is "we didn't call it"). Does not guard the regression.
Plan picks **(B)** — smallest change that actually guards the bug per testing.md (RED: stub returns
resolved value, assert deliberate passes resolved subject/criteria; current inline code can't be
driven, so the refactor + test is the RED→GREEN). Confirm in review.

## BUG 2 — gemini CLI exits 55 "not running in a trusted directory"

### Reproduced / root cause [FACT, reproduced]
`gemini-cli.ts` runs from `cwd=/tmp` (non-fileAccess) or project dir, args
`["-p", prompt, "--model", id, "-o", "json", "-y"]`. Live: every requested gemini judge failed.
Direct repro (gemini 0.40.1) from /tmp:
```
exit=55
"Gemini CLI is not running in a trusted directory. To proceed, either use `--skip-trust`,
 set the GEMINI_CLI_TRUST_WORKSPACE=true environment variable, or trust this directory..."
```
gemini 0.40.x added a folder-trust gate; `-y` (yolo) is downgraded to "default" approval in an
untrusted folder, then the headless run aborts with 55. The provider's `/tmp` cwd is untrusted.

### Fix [verified]
Add `--skip-trust` to the gemini args. Repro with it: `exit=0` and valid JSON (`"response":"OK"`).
```ts
args.push("-y");
args.push("--skip-trust");   // 0.40+ folder-trust gate; /tmp cwd is untrusted → exit 55 without it
```
Alternative considered: `env GEMINI_CLI_TRUST_WORKSPACE=true`. `--skip-trust` is explicit, per-session,
and visible in the arg list (preferred over a hidden env var). The error message lists both as valid.

### Safety note
`--skip-trust` only affects gemini's tool-approval/trust prompt. pyreez runs gemini with tools as
no-ops (non-fileAccess from /tmp) or read-only (fileAccess); model output is parsed, not executed.
Trusting the workspace for a read-only/no-tool headless inference call is safe.

### Test [TDD]
`gemini-cli.spec.ts` mocks `spawnWithIdleTimeout` and asserts the args array. RED: add assertion
`expect(args).toContain("--skip-trust")` (currently absent → fails). GREEN after the push.
Place `--skip-trust` deterministically so the assertion is stable regardless of fileAccess.

### Validate
- Re-run a real gemini call from /tmp with new args → exit 0 (already confirmed manually).
- Run a deliberation including a gemini model and confirm it responds (no swap to grok/flash).

## Sequencing
Independent fixes, separate logical commits. Bug 2 is lower-risk (1 line + 1 assertion). Bug 1's
test approach (B) is the only design decision. No engine changes for either.

## Open questions for review
1. Bug 1 test: (A) subprocess vs (B) extract-and-unit-test vs (C) export resolveValue. Plan picks B.
2. Bug 1: is documenting the single-`-` limit enough, or should the CLI error if both subject AND
   criteria are `-`? (Plan: document; erroring is gold-plating.)
3. Bug 2: `--skip-trust` vs `GEMINI_CLI_TRUST_WORKSPACE=true` env. Plan: `--skip-trust` (explicit).
   Any reason the env var is safer/more robust across gemini versions?
4. Bug 2: does `--skip-trust` exist in the gemini versions pyreez must support, or should we set BOTH
   the flag and the env var for resilience? (Repro'd on 0.40.1; older versions unknown.)
