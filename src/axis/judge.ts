/**
 * LlmJudge — Tier 3 LLM-as-Judge quality evaluator.
 *
 * Evaluates task-response pairs using a nano model to produce a 0-10 quality score.
 * Used by the learning layer to drive L1-L4 updates.
 */

import type { ChatFn } from "./types";

const DEFAULT_JUDGE_PROMPT = `Rate the following response on a scale of 0 to 10 based on: relevance, accuracy, completeness.

Task: {{task}}

Response: {{response}}

Return JSON: {"score": N}`;

const DEFAULT_SCORE = 5;

export interface LlmJudgeOptions {
  chatFn: ChatFn;
  judgeModel: string;
  prompt?: string;
}

export class LlmJudge {
  private readonly chatFn: ChatFn;
  private readonly judgeModel: string;
  private readonly promptTemplate: string;

  constructor(opts: LlmJudgeOptions) {
    this.chatFn = opts.chatFn;
    this.judgeModel = opts.judgeModel;
    this.promptTemplate = opts.prompt ?? DEFAULT_JUDGE_PROMPT;
  }

  /**
   * Evaluate a task-response pair and return a quality score (0-10).
   * On any error, returns DEFAULT_SCORE (5).
   */
  async evaluate(task: string, response: string): Promise<number> {
    try {
      const prompt = this.promptTemplate
        .replace("{{task}}", task)
        .replace("{{response}}", response);

      const raw = await this.chatFn(this.judgeModel, prompt);

      if (!raw || raw.trim().length === 0) {
        return DEFAULT_SCORE;
      }

      return this.parseScore(raw);
    } catch {
      return DEFAULT_SCORE;
    }
  }

  private parseScore(raw: string): number {
    // Try JSON parse first
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed.score === "number") {
        return this.clamp(parsed.score);
      }
    } catch {
      // JSON parse failed — try regex
    }

    // Regex fallback: find first number in response
    const match = raw.match(/\b(\d+(?:\.\d+)?)\b/);
    if (match) {
      const num = parseFloat(match[1]!);
      if (Number.isFinite(num)) {
        return this.clamp(Math.floor(num));
      }
    }

    return DEFAULT_SCORE;
  }

  private clamp(score: number): number {
    return Math.max(0, Math.min(10, score));
  }
}
