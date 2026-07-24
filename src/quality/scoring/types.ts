/**
 * Scoring feature type aliases.
 */

import type { ChatMessage } from "../../llm/types";

/**
 * 채점 훅의 chat 시임. judge·분류 콜은 항상 webAccess:false로 강제된다(v5 §0 — judge는
 * 절대 조회하지 않는다). wire.ts의 EngineDeps.chat과 구조적으로 호환되므로 그대로 주입 가능하다.
 */
export type ScoringChatFn = (
  model: string,
  messages: ChatMessage[],
  params?: { readonly webAccess?: boolean },
) => Promise<{ content: string }>;
