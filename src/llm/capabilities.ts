/**
 * Capability gating — validates a request against the resolved provider's declared capabilities
 * before dispatch, so unsupported options surface explicitly instead of being silently ignored.
 *
 * Policy by capability kind:
 * - web / fileAccess are CORRECTNESS-affecting: a silent downgrade makes the worker produce wrong
 *   output (e.g. confabulate instead of verifying via web) → hard error; the caller must route to a
 *   capable model or drop the requirement.
 * - effort is a soft tuning knob: absence degrades quality but not correctness → strip + record.
 */

import { LLMClientError } from "./errors";
import type { CapabilitySet, ChatCompletionRequest } from "./types";

interface GateResult {
  /** The request to dispatch — soft, unsupported capabilities stripped out. */
  readonly request: ChatCompletionRequest;
}

export function gateCapabilities(
  request: ChatCompletionRequest,
  caps: CapabilitySet,
): GateResult {
  if (request.webAccess && !caps.web) {
    throw new LLMClientError(
      400,
      `Provider for "${request.model}" does not support webAccess — route to a web-capable model or drop the requirement`,
      "capability_unsupported",
    );
  }
  if (request.fileAccess && !caps.fileAccess) {
    throw new LLMClientError(
      400,
      `Provider for "${request.model}" does not support fileAccess`,
      "capability_unsupported",
    );
  }

  let req = request;
  if (request.reasoning_effort && !caps.effort) {
    const { reasoning_effort: _dropped, ...rest } = request;
    req = rest;
  }

  return { request: req };
}
