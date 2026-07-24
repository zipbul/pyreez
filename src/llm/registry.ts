/**
 * ProviderRegistry — routes chat requests to the correct provider
 * based on model → provider mapping from models.json.
 */

import { LLMClientError } from "./errors";
import { gateCapabilities } from "./capabilities";
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
    // Prefer the explicit map; fall back to the id's provider prefix (e.g. "openai/gpt-5.5") when it
    // names a CONFIGURED provider. This lets live-discovered ids (absent from any curated map) route,
    // while a truly unknown id — or one whose prefix isn't a configured provider — still hard-errors.
    let providerName = this.modelProviderMap.get(request.model);
    if (!providerName) {
      const prefix = request.model.split("/")[0] as ProviderName;
      if (this.providers.has(prefix)) providerName = prefix;
    }
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

    // Gate the request against the provider's declared capabilities: hard-error on unsupported
    // correctness capabilities (web/file), strip soft ones (effort) so they aren't silently ignored.
    const { request: gated } = gateCapabilities(request, provider.capabilities);
    return provider.chat(gated);
  }
}
