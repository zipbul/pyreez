/**
 * Axis factory — createEngine() with compatibility validation.
 *
 * Classifier-Profiler compatibility matrix:
 *   keyword     + domain-override  → ✅ (taskType vocab → domain lookup)
 *   keyword     + step-profile     → ❌ R-A1+R-B2 vocab mismatch
 *   keyword     + moe-gating       → ✅ (MoE accepts any vocab)
 *   step-declare + domain-override → ❌ R-A2+R-B1 vocab mismatch
 *   step-declare + step-profile    → ✅ (step vocab → step lookup)
 *   step-declare + moe-gating      → ✅ (MoE accepts any vocab)
 *   llm         + any              → ✅
 *   embedding   + any              → ✅
 */

import { PyreezEngine } from "./engine";
import {
  KeywordClassifier,
  BtScoringSystem,
  DomainOverrideProfiler,
  MoeGatingProfiler,
  TwoTrackCeSelector,
  CascadeSelector,
  PreferenceSelector,
  RoleBasedProtocol,
} from "./wrappers";
import type { AxisConfig, ChatFn } from "./types";
import type {
  ScoringSystem,
  Classifier,
  Profiler,
  Selector,
  DeliberationProtocol,
} from "./interfaces";

// -- All 21 model IDs in the registry --

export const ALL_MODEL_IDS: readonly string[] = [
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3",
  "openai/o4-mini",
  "deepseek/DeepSeek-R1-0528",
  "deepseek/DeepSeek-V3-0324",
  "xai/grok-3",
  "xai/grok-3-mini",
  "meta/Llama-4-Maverick-17B-128E-Instruct-FP8",
  "meta/Llama-4-Scout-17B-16E-Instruct",
  "microsoft/Phi-4-reasoning",
  "microsoft/Phi-4",
  "microsoft/Phi-4-mini-instruct",
  "mistral/Codestral-2501",
  "mistral/Mistral-Medium-3",
  "anthropic/claude-opus-4.6",
  "google/gemini-3.1-pro",
  "openai/gpt-5.3",
];

// -- Default configuration --

export const DEFAULT_CONFIG: AxisConfig = {
  scoring: "bt-21",
  classifier: "keyword",
  profiler: "domain-override",
  selector: "2track-ce",
  deliberation: "role-based",
  consensus: "leader_decides",
  learning: {
    tier0: true,
    tier1: false,
    tier2: false,
    tier3: false,
  },
  modelIds: [...ALL_MODEL_IDS],
};

// -- Compatibility matrix --

/** Returns true when the classifier→profiler pair is valid. */
function isCompatible(
  classifier: AxisConfig["classifier"],
  profiler: AxisConfig["profiler"],
): boolean {
  // MoE gating accepts any classifier vocab
  if (profiler === "moe-gating") return true;
  // LLM and embedding classifiers are considered compatible with all profilers
  if (classifier === "llm" || classifier === "embedding") return true;

  // keyword → domain-override: ✅   keyword → step-profile: ❌
  if (classifier === "keyword" && profiler === "domain-override") return true;
  if (classifier === "keyword" && profiler === "step-profile") return false;

  // step-declare → step-profile: ✅  step-declare → domain-override: ❌
  if (classifier === "step-declare" && profiler === "step-profile") return true;
  if (classifier === "step-declare" && profiler === "domain-override") return false;

  // Fallback: allow (future combinations)
  return true;
}

// -- Slot factory helpers --

function buildScoring(_config: AxisConfig): ScoringSystem {
  // Phase 1: only bt-21 is implemented
  return new BtScoringSystem();
}

function buildClassifier(config: AxisConfig): Classifier {
  switch (config.classifier) {
    case "keyword":
      return new KeywordClassifier();
    default:
      // Phase 1 stub — fall back to keyword for unimplemented classifiers
      return new KeywordClassifier();
  }
}

function buildProfiler(config: AxisConfig): Profiler {
  switch (config.profiler) {
    case "domain-override":
      return new DomainOverrideProfiler();
    case "moe-gating":
      return new MoeGatingProfiler();
    default:
      return new DomainOverrideProfiler();
  }
}

function buildSelector(config: AxisConfig): Selector {
  switch (config.selector) {
    case "2track-ce":
      return new TwoTrackCeSelector();
    case "cascade":
      return new CascadeSelector();
    case "preference":
      return new PreferenceSelector();
    default:
      return new TwoTrackCeSelector();
  }
}

function buildDeliberation(_config: AxisConfig): DeliberationProtocol {
  // Phase 1: only role-based stub is implemented
  return new RoleBasedProtocol();
}

// -- Public API --

/**
 * Creates a PyreezEngine from configuration.
 * Throws if the classifier-profiler combination is invalid.
 *
 * @param config - Axis pipeline configuration (use DEFAULT_CONFIG as base).
 * @param chat - Optional ChatFn. If omitted, a stub is used (throws on run).
 */
export function createEngine(
  config: AxisConfig,
  chat?: ChatFn,
): PyreezEngine {
  // Validate classifier-profiler compatibility
  if (!isCompatible(config.classifier, config.profiler)) {
    throw new Error(
      `Incompatible classifier-profiler pair: "${config.classifier}" + "${config.profiler}". ` +
      `Classifier vocab mismatch — use "moe-gating" profiler for cross-vocab routing.`,
    );
  }

  const scoring = buildScoring(config);
  const classifier = buildClassifier(config);
  const profiler = buildProfiler(config);
  const selector = buildSelector(config);
  const deliberation = buildDeliberation(config);
  const modelIds = config.modelIds ?? [...ALL_MODEL_IDS];

  // If no chat function provided, use a stub that throws at runtime
  const effectiveChat: ChatFn =
    chat ??
    ((_modelId, _prompt) => {
      throw new Error(
        "No chat function provided to createEngine(). " +
        "Pass a ChatFn as the second argument to enable run().",
      );
    });

  return new PyreezEngine(
    scoring,
    classifier,
    profiler,
    selector,
    deliberation,
    effectiveChat,
    modelIds,
  );
}
