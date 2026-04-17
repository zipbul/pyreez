/**
 * Alignment classifier — LLM judge decides whether a worker response is
 * on-task (answered the question) or meta-critique (rejected the framing
 * or proposed an unrelated alternative).
 *
 * Removes the host's manual alignment chore in acceptance.
 *
 * @module quality/alignment-classifier
 */

import type { ChatMessage } from "../llm/types";

export type Alignment = "on-task" | "meta-critique";

export interface ChatFn {
  (model: string, messages: ChatMessage[]): Promise<{ content: string }>;
}

const SYSTEM = `You are classifying whether a response answers the given task or rejects the task's framing.

ON-TASK: the response engages with the task as posed and provides an answer (even if the answer is "no" or "it depends").
META-CRITIQUE: the response rejects the task's framing as wrong, redefines the question, or proposes an unrelated alternative instead of answering.

Output exactly:
<alignment>ON-TASK</alignment>
or
<alignment>META-CRITIQUE</alignment>`;

function buildMessages(task: string, response: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `<task>${task}</task>\n\n<response>\n${response}\n</response>\n\nClassify the response.`,
    },
  ];
}

/**
 * Classify a single worker response. Defaults to "on-task" on malformed output —
 * the safer default (preserves verdict participation) when the judge fails.
 */
export async function classifyAlignment(
  model: string,
  chat: ChatFn,
  task: string,
  responseContent: string,
): Promise<Alignment> {
  const r = await chat(model, buildMessages(task, responseContent));
  const m = r.content.match(/<alignment>\s*(ON-TASK|META-CRITIQUE)\s*<\/alignment>/i);
  if (!m) return "on-task";
  return m[1]!.toUpperCase() === "META-CRITIQUE" ? "meta-critique" : "on-task";
}
