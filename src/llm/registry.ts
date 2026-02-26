/**
 * ProviderRegistry — routes chat requests to the correct provider
 * based on model → provider mapping from models.json.
 */

import { LLMClientError } from "./errors";
import type {
  ProviderName,
  LLMProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
} from "./types";

export class ProviderRegistry {
  private readonly providers: ReadonlyMap<ProviderName, LLMProvider>;
  private readonly modelProviderMap: ReadonlyMap<string, ProviderName>;

  constructor(
    providers: LLMProvider[],
    modelProviderMap: ReadonlyMap<string, ProviderName>,
  ) {
    const map = new Map<ProviderName, LLMProvider>();
    for (const provider of providers) {
      map.set(provider.name, provider);
    }
    this.providers = map;
    this.modelProviderMap = modelProviderMap;
  }

  async chat(request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    const providerName = this.modelProviderMap.get(request.model);
    if (!providerName) {
      throw new LLMClientError(
        400,
        `Unknown model: ${request.model}`,
        "unknown_model",
      );
    }

    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new LLMClientError(
        503,
        `Provider "${providerName}" is not configured`,
        "provider_not_configured",
      );
    }

    return provider.chat(request);
  }
}
