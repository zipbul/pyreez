/**
 * LLM-backed CrossValidateFn: asks an LLM to identify subject claims that
 * are unsupported or contradicted by the other responses.
 */

import type { CrossValidateFn, ResponseUnderReview, JudgeResult } from "./cross-validate";
import type { ChatMessage } from "../llm/types";

export interface ChatFn {
  (model: string, messages: ChatMessage[]): Promise<{ content: string }>;
}

const SYSTEM = `You are checking whether the factual claims in one response are corroborated by other responses to the same task.
Identify only factual claims (specific facts, numbers, dates, named entities, mechanisms). Skip opinions, preferences, and reasoning steps.
Output exactly this XML structure:
<unsupported>
- claim 1
- claim 2
</unsupported>
<contradicted>
- claim 1 (contradicted by: brief quote or paraphrase)
- claim 2 (contradicted by: brief quote or paraphrase)
</contradicted>
If a section is empty, write "- none" inside it.`;

function buildMessages(subject: ResponseUnderReview, others: readonly ResponseUnderReview[]): ChatMessage[] {
  const otherBlocks = others
    .map((o, i) => `<other-response index="${i + 1}">\n${o.content}\n</other-response>`)
    .join("\n\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `<response-under-review>
${subject.content}
</response-under-review>

${otherBlocks}

List the factual claims in <response-under-review> that no <other-response> supports (unsupported), and the claims that an <other-response> contradicts (contradicted).`,
    },
  ];
}

function parseList(text: string, tag: string): string[] {
  const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  if (!match) return [];
  return match[1]!
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*-\s*/, "").trim())
    .filter((line) => line.length > 0 && line.toLowerCase() !== "none");
}

/**
 * Create an LLM-backed CrossValidateFn for a chosen judge model.
 */
export function createLLMCrossValidator(model: string, chat: ChatFn): CrossValidateFn {
  return async (subject, others) => {
    const result = await chat(model, buildMessages(subject, others));
    const out: JudgeResult = {
      unsupportedClaims: parseList(result.content, "unsupported"),
      contradictedClaims: parseList(result.content, "contradicted"),
    };
    return out;
  };
}
