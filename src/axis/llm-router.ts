/**
 * LlmRouter — Tier 2 LLM-as-End-to-End-Router.
 *
 * Bypasses slots 2-3-4 by asking an LLM directly which model(s) to use.
 * Returns an EnsemblePlan or null (fallback to normal pipeline).
 */

import type { ChatFn, EnsemblePlan } from "./types";

export interface LlmRouterOptions {
  chatFn: ChatFn;
  routerModel: string;
  modelIds: string[];
}

const ROUTER_PROMPT_TEMPLATE = `You are a model router. Given the available models and a task, recommend which model(s) to use.

Available models: {{models}}

Task: {{task}}

Respond with JSON: {"model": "model-id"} for single model, or {"models": ["model-a", "model-b"]} for multiple.`;

export class LlmRouter {
  private readonly chatFn: ChatFn;
  private readonly routerModel: string;
  private readonly modelIds: string[];

  constructor(opts: LlmRouterOptions) {
    this.chatFn = opts.chatFn;
    this.routerModel = opts.routerModel;
    this.modelIds = opts.modelIds;
  }

  /**
   * Route a prompt by asking an LLM which model(s) to use.
   * Returns an EnsemblePlan or null if routing fails.
   */
  async route(prompt: string): Promise<EnsemblePlan | null> {
    try {
      const routerPrompt = ROUTER_PROMPT_TEMPLATE
        .replace("{{models}}", this.modelIds.join(", "))
        .replace("{{task}}", prompt);

      const result = await this.chatFn(this.routerModel, routerPrompt);
      const raw = result.content;

      if (!raw || raw.trim().length === 0) {
        return null;
      }

      const recommended = this.parseRecommendation(raw);
      if (recommended.length === 0) {
        return null;
      }

      return {
        models: recommended.map((id) => ({ modelId: id })),
        strategy: "llm-router",
        estimatedCost: 0,
        reason: `LLM router recommended: ${recommended.join(", ")}`,
      };
    } catch {
      return null;
    }
  }

  /**
   * Parse LLM response to extract model recommendations.
   * Tries JSON first, then text search for known model IDs.
   */
  private parseRecommendation(raw: string): string[] {
    // Try JSON parse
    try {
      const parsed = JSON.parse(raw);

      // Single model: {"model": "..."}
      if (typeof parsed.model === "string") {
        const validated = this.validateModels([parsed.model]);
        return validated;
      }

      // Multiple models: {"models": [...]}
      if (Array.isArray(parsed.models)) {
        const validated = this.validateModels(parsed.models);
        return validated;
      }
    } catch {
      // JSON parse failed — try text search
    }

    // Text fallback: search for known model IDs in response
    const found = this.modelIds.filter((id) => raw.includes(id));
    return found.length > 0 ? found : [];
  }

  /**
   * Validate that all recommended model IDs exist in the known list.
   * Returns only valid models. If none are valid, returns empty array.
   */
  private validateModels(models: string[]): string[] {
    return models.filter((m) => this.modelIds.includes(m));
  }
}
