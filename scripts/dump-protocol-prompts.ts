/**
 * Dump full per-protocol prompts (worker side) verbatim into markdown files.
 *
 * Calls each prompt builder with fixed sample inputs and writes the exact
 * system + user messages to docs/protocol-prompts/<protocol>.md, paired with
 * the user-agent-facing skill context for that protocol.
 *
 * Run:  bun run scripts/dump-protocol-prompts.ts
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  buildSharedConvergenceR1,
  buildSharedConvergenceR2,
  buildSharedConvergenceFollowUp,
  buildAdversarialDebateR1,
  buildAdversarialDebateR2,
  buildAdversarialDebateFollowUp,
  buildHostInterrogationMessages,
  buildSequentialRefinementMessages,
  buildEvaluationScoringMessages,
  buildRedTeamGeneratorMessages,
  buildRedTeamAttackerMessages,
  buildAcceptanceMessages,
} from "../src/deliberation/prompts";
import type {
  SharedContext,
  WorkerResponse,
  InterrogationExchange,
} from "../src/deliberation/types";
import type { ChatMessage } from "../src/llm/types";

// ---- Fixed sample inputs (one shared task for cross-protocol comparison) ----

const SAMPLE_TASK =
  "Identify 3 specific conditions under which choosing PostgreSQL as the default database produces worse outcomes than MongoDB for a 4-person SaaS team launching an MVP within 6 months.";

// A representative, LEGITIMATE host instruction. Deliberately NOT a "cite an external source per claim"
// demand: on a no-lookup worker that forces citation fabrication (documented in the adversarial playbook),
// and it was observed to mislead reviewers into reading it as a baked rule. Domain-grounding is the safe shape.
const SAMPLE_INSTRUCTIONS =
  "Tie each point to the team's stated constraints (4 people, 6-month MVP) and be concrete about the conditions under which it applies.";

const SAMPLE_TEAM = {
  workers: [
    { model: "openai/gpt-5", role: "worker" as const },
    { model: "anthropic/claude-opus-4-7", role: "worker" as const },
    { model: "google/gemini-2.5-pro", role: "worker" as const },
  ],
};

const SAMPLE_CTX_R1: SharedContext = {
  task: SAMPLE_TASK,
  team: SAMPLE_TEAM,
  rounds: [],
};

const SAMPLE_R1_RESPONSES: WorkerResponse[] = [
  {
    model: "openai/gpt-5",
    workerIndex: 0,
    confidence: "medium",
    content:
      "Position: PostgreSQL underperforms MongoDB when (a) schema churns weekly during MVP, (b) workload is document-shaped with deeply nested JSON, (c) ops capacity is zero. Evidence: MongoDB Atlas free tier removes ops burden; pg JSONB lacks per-field index ergonomics.",
  },
  {
    model: "anthropic/claude-opus-4-7",
    workerIndex: 1,
    confidence: "high",
    content:
      "Position: The premise is suspect — PostgreSQL is rarely worse for MVPs. Conditions where it loses: (1) team has zero SQL experience and prototypes in JS/TS only, (2) data model is genuinely graph/document with cross-collection joins rare, (3) deploy target is serverless with cold-start sensitivity (Neon mitigates but not fully).",
  },
  {
    model: "google/gemini-2.5-pro",
    workerIndex: 2,
    confidence: "low",
    content:
      "Position: Cannot decide without traffic profile. If reads dominate and shape is fixed → PostgreSQL wins. If shape mutates and team writes only TS → MongoDB ergonomics win. Evidence weak — depends on team's stack familiarity, which is unspecified.",
  },
];

const SAMPLE_OWN_PREV: WorkerResponse = SAMPLE_R1_RESPONSES[0]!;

const SAMPLE_CTX_R2: SharedContext = {
  task: SAMPLE_TASK,
  team: SAMPLE_TEAM,
  rounds: [
    { number: 1, responses: SAMPLE_R1_RESPONSES, protocol: "shared_convergence" },
  ],
};

const SAMPLE_QUESTION =
  "What is the single most likely failure mode for PostgreSQL on a 4-person SaaS MVP and what early signal precedes it?";

const SAMPLE_PREV_EXCHANGES: InterrogationExchange[] = [
  {
    question: "Have you previously assumed any specific traffic profile?",
    answer:
      "I assumed read-heavy with stable schema. If that assumption breaks, PostgreSQL's edge weakens.",
  },
];

const SAMPLE_CRITERIA = `1. Team velocity impact during MVP phase (weight 40%)
2. Operational burden for a 4-person team without dedicated DBA (weight 30%)
3. Schema evolution friction during weekly iteration (weight 30%)`;

const SAMPLE_SUBJECT =
  "Decision: Adopt PostgreSQL as the default database for a 4-person SaaS MVP launching in 6 months, with MongoDB rejected during architecture review.";

const SAMPLE_PREVIOUS_OUTPUT =
  "## Draft v1\nPostgreSQL is the right default because relational integrity catches MVP-stage data bugs early. Migrations cost an afternoon. JSONB covers document needs. Recommended: PostgreSQL.";

const SAMPLE_PREVIOUS_ATTACK_RESULTS = `Critical: The draft assumes JSONB is sufficient but does not specify GIN indexing strategy — queries on nested document fields will full-scan at 100k rows.
High: "Migrations cost an afternoon" is unsubstantiated; no estimate model provided.
Medium: Recommendation lacks rollback plan if schema thrash exceeds expectations.`;

const SAMPLE_TARGET_OUTPUTS = [SAMPLE_PREVIOUS_OUTPUT];

const SAMPLE_SYNTHESIS = `## Synthesis\nPostgreSQL is the safer default for this MVP under three guardrails: (1) commit to JSONB only for genuinely sparse fields with explicit GIN indexes, (2) cap schema-changing migrations at 1/week with a rollback script, (3) revisit at 50k MAU. MongoDB wins only if the team has zero SQL fluency AND the data shape is deeply nested AND ops capacity is genuinely zero — a rare conjunction.`;

const SAMPLE_ORIGINAL_POSITION = SAMPLE_R1_RESPONSES[0]!.content;

// ---- Render helpers ----

function renderMessages(messages: ChatMessage[]): string {
  return messages
    .map((m) => `### role: \`${m.role}\`\n\n\`\`\`\n${m.content}\n\`\`\``)
    .join("\n\n");
}

function renderSingleMessage(m: ChatMessage): string {
  return `### role: \`${m.role}\`\n\n\`\`\`\n${m.content}\n\`\`\``;
}

// ---- Skill context loader ----

const SKILL_DIR = join(import.meta.dir, "..", ".claude", "skills", "pyreez");

function readSkillFile(name: string): string | null {
  const p = join(SKILL_DIR, name);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
}

// ---- Per-protocol dumpers ----

interface ProtocolDump {
  protocol: string;
  workerSections: { title: string; messages: ChatMessage[] | ChatMessage }[];
  notes: string[];
}

function dumpSharedConvergence(): ProtocolDump {
  return {
    protocol: "shared_convergence",
    workerSections: [
      {
        title:
          "Worker R1 (workerIndex=0, roundInfo={current:1,max:3}, instructions present) — `buildSharedConvergenceR1`",
        messages: buildSharedConvergenceR1(
          SAMPLE_CTX_R1,
          SAMPLE_INSTRUCTIONS,
          { current: 1, max: 3 },
          0,
        ),
      },
      {
        title:
          "Worker R1 (workerIndex=1) — diversity lens 차이 확인용",
        messages: buildSharedConvergenceR1(
          SAMPLE_CTX_R1,
          SAMPLE_INSTRUCTIONS,
          { current: 1, max: 3 },
          1,
        ),
      },
      {
        title:
          "Worker R2 (workerIndex=0, current=2/max=3, otherResponses=[1,2], ownPrevious=[0]) — `buildSharedConvergenceR2`",
        messages: buildSharedConvergenceR2(
          SAMPLE_CTX_R2,
          SAMPLE_R1_RESPONSES.filter((r) => r.workerIndex !== 0),
          SAMPLE_OWN_PREV,
          SAMPLE_INSTRUCTIONS,
          { current: 2, max: 3 },
          0,
        ),
      },
      {
        title:
          "Worker R3 final round (workerIndex=0, current=3/max=3) — `buildSharedConvergenceR2` with final-round notice",
        messages: buildSharedConvergenceR2(
          SAMPLE_CTX_R2,
          SAMPLE_R1_RESPONSES.filter((r) => r.workerIndex !== 0),
          SAMPLE_OWN_PREV,
          SAMPLE_INSTRUCTIONS,
          { current: 3, max: 3 },
          0,
        ),
      },
      {
        title:
          "Worker FollowUp (session continuation, workerIndex=0, current=2/max=3) — `buildSharedConvergenceFollowUp`",
        messages: buildSharedConvergenceFollowUp(
          SAMPLE_CTX_R2,
          SAMPLE_R1_RESPONSES.filter((r) => r.workerIndex !== 0),
          SAMPLE_INSTRUCTIONS,
          { current: 2, max: 3 },
          0,
        ),
      },
    ],
    notes: [
      "R1: lens 주입은 `roundInfo.max > 1` 조건. 단일 라운드면 lens 없음 (`prompts.ts:175-178`).",
      "R2: lens 복원 (round 간 lens loss 방지, `prompts.ts:230-233`) + ANTI_CONFORMITY constraints + final-round commit notice (`prompts.ts:238-240`).",
      "FollowUp: `system` 메시지 없음 — 기존 세션의 누적된 history 위에 user message 1개만 append.",
    ],
  };
}

function dumpAdversarialDebate(): ProtocolDump {
  return {
    protocol: "adversarial_debate",
    workerSections: [
      {
        title: "Worker R1 — `buildAdversarialDebateR1`",
        messages: buildAdversarialDebateR1(SAMPLE_CTX_R1, SAMPLE_INSTRUCTIONS),
      },
      {
        title:
          "Worker R2 (final round) — `buildAdversarialDebateR2` (`<positions-to-challenge>` + `<approach>` + `<closing>`)",
        messages: buildAdversarialDebateR2(
          SAMPLE_CTX_R2,
          SAMPLE_R1_RESPONSES.filter((r) => r.workerIndex !== 0),
          SAMPLE_OWN_PREV,
          SAMPLE_INSTRUCTIONS,
          { current: 3, max: 3 },
          0,
        ),
      },
      {
        title: "Worker FollowUp (final round) — `buildAdversarialDebateFollowUp`",
        messages: buildAdversarialDebateFollowUp(
          SAMPLE_CTX_R2,
          SAMPLE_R1_RESPONSES.filter((r) => r.workerIndex !== 0),
          SAMPLE_INSTRUCTIONS,
          { current: 3, max: 3 },
          0,
        ),
      },
    ],
    notes: [
      "No stance lens — diversity comes from heterogeneous models plus a per-worker <attack-angle> (R1/R2/FollowUp) and the R2 challenge structure.",
      "System block is read-only standing rules: role, <evidence-and-confidence> (no-lookup → reasoning is default evidence, cite only exact-recall, fabrication forbidden, uncertain → [unverified]/LOW), and <output-format> (severity-ordered findings: severity/confidence/target/steelman/weakness/evidence/falsification + acceptability line).",
      "Drift-sensitive <approach> (steelman / no-soften / revise-only-on-own-evidence / confidence label) is re-injected into every round's user turn so late-round conformity cannot erode it.",
      "Final round adds a <closing> consolidation signal (no forced consensus). FollowUp carries no system message — it appends one user turn onto the accumulated session history.",
    ],
  };
}

function dumpHostInterrogation(): ProtocolDump {
  return {
    protocol: "host_interrogation",
    workerSections: [
      {
        title:
          "Worker (no previous exchanges) — `buildHostInterrogationMessages`",
        messages: buildHostInterrogationMessages(SAMPLE_TASK, SAMPLE_QUESTION),
      },
      {
        title:
          "Worker (with previous exchanges, session continuation)",
        messages: buildHostInterrogationMessages(
          SAMPLE_TASK,
          SAMPLE_QUESTION,
          SAMPLE_PREV_EXCHANGES,
        ),
      },
    ],
    notes: [
      "워커 간 격리 — 다른 워커 응답 미주입 (`prompts.ts:415-436`).",
      "system prompt에 false-premise 거부 강제 (`prompts.ts:407-410`).",
      "`workerInstructions`는 빌더 시그니처에 없음 — host_interrogation은 host instructions를 주입하지 않는다 (`prompts.ts:415-419`).",
    ],
  };
}

function dumpSequentialRefinement(): ProtocolDump {
  return {
    protocol: "sequential_refinement",
    workerSections: [
      {
        title:
          "Worker[0] — chain 첫 워커 (previousOutput 없음, R1-style fallback) — `buildSharedConvergenceR1`로 위임",
        messages: buildSequentialRefinementMessages(
          SAMPLE_CTX_R1,
          undefined,
          SAMPLE_INSTRUCTIONS,
        ),
      },
      {
        title:
          "Worker[1+] — 이후 체인 워커 (previousOutput 주어짐) — `buildSequentialRefinementMessages`",
        messages: buildSequentialRefinementMessages(
          SAMPLE_CTX_R1,
          SAMPLE_PREVIOUS_OUTPUT,
          SAMPLE_INSTRUCTIONS,
        ),
      },
    ],
    notes: [
      "첫 워커는 buildSharedConvergenceR1 호출(`prompts.ts:460-462`) — 즉 lens 주입 조건(maxRounds>1)에 따라 lens 가능. 단 default maxRounds=1(`wire.ts:153`)이라 사실상 lens 없음.",
      "이후 워커는 specialized system prompt — 'Do not rewrite from scratch', 'Shortening is not improving' (`prompts.ts:443-448`).",
      "DEPTH_REFINE 추가 (`prompts.ts:41`): 변경에 대한 강한 반론 자가 생성.",
    ],
  };
}

function dumpEvaluationScoring(): ProtocolDump {
  return {
    protocol: "evaluation_scoring",
    workerSections: [
      {
        title: "Worker — `buildEvaluationScoringMessages`",
        messages: buildEvaluationScoringMessages(
          SAMPLE_TASK,
          SAMPLE_CRITERIA,
          SAMPLE_SUBJECT,
          SAMPLE_INSTRUCTIONS,
        ),
      },
    ],
    notes: [
      "워커 격리 — role 라인 'Evaluate independently'만으로 강제. 단일 라운드라 peer 출력이 주입되는 경로 자체가 없음.",
      "출력 형식 강제: judgment/confidence/verdict/score 4줄. verdict는 다섯 tier 단어 중 하나, score는 그 tier band에 고정.",
      "DEPTH_EXPLORE / DEPTH_REFINE 미주입 — `buildSystemPrompt` 두 번째 인자 생략.",
      "CONFIDENCE_AND_UNCERTAINTY 별도 fragment 미주입. 주장별 confidence는 본문에 산문으로, 리터럴 HIGH/MEDIUM/LOW 토큰은 마지막 confidence 줄에만.",
    ],
  };
}

function dumpRedTeam(): ProtocolDump {
  return {
    protocol: "red_team",
    workerSections: [
      {
        title:
          "Generator (R1, no previous attack) — `buildRedTeamGeneratorMessages`",
        messages: buildRedTeamGeneratorMessages(SAMPLE_TASK, SAMPLE_INSTRUCTIONS),
      },
      {
        title:
          "Generator (R2, with previous attack results)",
        messages: buildRedTeamGeneratorMessages(
          SAMPLE_TASK,
          SAMPLE_INSTRUCTIONS,
          SAMPLE_PREVIOUS_ATTACK_RESULTS,
        ),
      },
      {
        title: "Attacker — `buildRedTeamAttackerMessages`",
        messages: buildRedTeamAttackerMessages(
          SAMPLE_TASK,
          SAMPLE_TARGET_OUTPUTS,
          SAMPLE_INSTRUCTIONS,
        ),
      },
    ],
    notes: [
      "비대칭 system prompt: generator는 edge case 사전 대응 (`prompts.ts:521-529`), attacker는 'concrete, exploitable' + severity 랭킹 + 'Do not fabricate' (`prompts.ts:531-539`).",
      "DEPTH_EXPLORE / DEPTH_REFINE 미주입 — 두 system 모두 `buildSystemPrompt` 두 번째 인자 생략 (`prompts.ts:521, 531`).",
      "CONFIDENCE_AND_UNCERTAINTY 미주입.",
    ],
  };
}

function dumpAcceptance(): ProtocolDump {
  return {
    protocol: "acceptance_round",
    workerSections: [
      {
        title:
          "Acceptance — `buildAcceptanceMessages` (모든 프로토콜 공통, 합성 후 워커별 ratify)",
        messages: buildAcceptanceMessages(
          SAMPLE_SYNTHESIS,
          SAMPLE_ORIGINAL_POSITION,
          SAMPLE_TASK,
        ),
      },
    ],
    notes: [
      "프로토콜 아님 — 합성문에 대한 워커 ratify 단계. 참고용으로 함께 dump.",
      "출력 강제 XML: `<acceptance><verdict>…</verdict>…</acceptance>` (`prompts.ts:601-608`).",
    ],
  };
}

// ---- Write files ----

function writeWorkerFile(dump: ProtocolDump) {
  const outPath = join(
    import.meta.dir,
    "..",
    "docs",
    "protocol-prompts",
    dump.protocol,
    "worker.md",
  );
  mkdirSync(dirname(outPath), { recursive: true });

  const lines: string[] = [];
  lines.push(`# \`${dump.protocol}\` — Worker Full Prompt`);
  lines.push("");
  lines.push(
    "워커 LLM이 실제로 받는 메시지 array. `prompts.ts`의 빌더 함수 반환값을 verbatim 복사.",
  );
  lines.push(
    "엔진 → LLM client (`chat(model, messages, params)`)는 메시지 content 변형 없음 — 본 dump = 프로바이더에 도달하는 prompt 그대로.",
  );
  lines.push("");
  lines.push("**Sample inputs (모든 프로토콜 공유, 프로덕션에서는 사용자 입력으로 치환)**:");
  lines.push("");
  lines.push(`- \`task\`: ${JSON.stringify(SAMPLE_TASK)}`);
  lines.push(`- \`workerInstructions\`: ${JSON.stringify(SAMPLE_INSTRUCTIONS)}`);
  lines.push("- `team`: 3 workers (gpt-5, claude-opus-4-7, gemini-2.5-pro)");
  lines.push("");
  for (const section of dump.workerSections) {
    lines.push(`## ${section.title}`);
    lines.push("");
    if (Array.isArray(section.messages)) {
      lines.push(renderMessages(section.messages));
    } else {
      lines.push(renderSingleMessage(section.messages));
    }
    lines.push("");
  }
  if (dump.notes.length > 0) {
    lines.push("## Notes (코드 fact 출처)");
    lines.push("");
    for (const n of dump.notes) lines.push(`- ${n}`);
    lines.push("");
  }

  writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${outPath}`);
}

function readPlaybook(
  protocol: string,
  skillFile: string | null,
): { source: string; body: string } | null {
  // Prefer skill file (production location) if present.
  if (skillFile) {
    const skillBody = readSkillFile(skillFile);
    if (skillBody) {
      return { source: `.claude/skills/pyreez/${skillFile}`, body: skillBody };
    }
  }
  // Fallback: docs draft.
  const draftPath = join(
    import.meta.dir,
    "..",
    "docs",
    "protocol-prompts",
    protocol,
    "playbook.md",
  );
  if (existsSync(draftPath)) {
    return {
      source: `docs/protocol-prompts/${protocol}/playbook.md`,
      body: readFileSync(draftPath, "utf8"),
    };
  }
  return null;
}

function writeUserAgentFile(protocol: string, deepPlaybookFile: string | null) {
  const outPath = join(
    import.meta.dir,
    "..",
    "docs",
    "protocol-prompts",
    protocol,
    "user-agent.md",
  );
  mkdirSync(dirname(outPath), { recursive: true });

  const skillMd = readSkillFile("SKILL.md");
  const playbook = readPlaybook(protocol, deepPlaybookFile);

  const lines: string[] = [];
  lines.push(`# \`${protocol}\` — User Agent Full Context`);
  lines.push("");
  lines.push(
    `소비 에이전트가 \`${protocol}\` 프로토콜로 deliberate를 호출할 때 컨텍스트에 로드되는 자료 verbatim merge.`,
  );
  lines.push(
    "구성: (1) `.claude/skills/pyreez/SKILL.md` 전체 + (2) 해당 프로토콜 deep playbook.",
  );
  lines.push("");
  lines.push(
    "**참고**: 본 파일은 종합 검토용 단일 view. 코드 블록 wrapping 없이 두 자료를 평면 병합.",
  );
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("# Part 1 — `.claude/skills/pyreez/SKILL.md`");
  lines.push("");
  lines.push("> 출처: `.claude/skills/pyreez/SKILL.md`");
  lines.push("");
  lines.push(skillMd ?? "<MISSING>");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push(`# Part 2 — \`${protocol}\` deep playbook`);
  lines.push("");
  if (playbook) {
    lines.push(`> 출처: \`${playbook.source}\``);
    lines.push("");
    lines.push(playbook.body);
  } else {
    lines.push(
      `> **GAP**: 이 프로토콜에 대한 deep playbook 미존재. 사용자 에이전트는 SKILL.md \`Protocols\` 표 한 행만 보유.`,
    );
  }
  lines.push("");

  writeFileSync(outPath, lines.join("\n"));
  console.log(`wrote ${outPath}`);
}

// `deep` = skill file name in .claude/skills/pyreez/. null이면 docs 안 playbook.md fallback.
const dumps: { dump: ProtocolDump; deep: string | null }[] = [
  { dump: dumpSharedConvergence(), deep: "shared-convergence.md" },
  { dump: dumpAdversarialDebate(), deep: null },
  { dump: dumpHostInterrogation(), deep: null },
  { dump: dumpSequentialRefinement(), deep: null },
  { dump: dumpEvaluationScoring(), deep: null },
  { dump: dumpRedTeam(), deep: null },
  { dump: dumpAcceptance(), deep: null },
];

for (const { dump, deep } of dumps) {
  writeWorkerFile(dump);
  writeUserAgentFile(dump.protocol, deep);
}

console.log("done");
