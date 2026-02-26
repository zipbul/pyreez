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
  SingleBestProtocol,
  DivergeSynthProtocol,
  AdaptiveDelibProtocol,
  // Phase 3
  StepProfiler,
  StepDeclareClassifier,
  StepBtScoringSystem,
  FourStrategySelector,
  // Phase 8
  FreeDebateProtocol,
  LlmJudgeScoringSystem,
  MabSelector,
} from "./wrappers";
import { PreferenceTable } from "../router/preference";
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
  // OpenAI (direct API)
  "openai/gpt-4.1",
  "openai/gpt-4.1-mini",
  "openai/gpt-4.1-nano",
  "openai/gpt-4o",
  "openai/gpt-4o-mini",
  "openai/o3",
  "openai/o4-mini",
  "openai/gpt-5.3",
  // Anthropic (via CLI or SDK)
  "anthropic/claude-opus-4.6",
  "anthropic/claude-sonnet-4.6",
  "anthropic/claude-haiku-4.5",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.5",
  "anthropic/claude-opus-4.1",
  "anthropic/claude-sonnet-4",
  "anthropic/claude-opus-4",
  // Google
  "google/gemini-2.5-pro",
  "google/gemini-2.5-flash",
  "google/gemini-2.5-flash-lite",
  "google/gemini-2.0-flash",
  "google/gemini-3-flash-preview",
  "google/gemini-3-pro-preview",
  "google/gemini-3.1-pro-preview",
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

function buildScoring(config: AxisConfig): ScoringSystem {
  switch (config.scoring) {
    case "bt-step":
      return new StepBtScoringSystem();
    case "bt-21":
    default:
      return new BtScoringSystem();
  }
}

function buildClassifier(config: AxisConfig): Classifier {
  switch (config.classifier) {
    case "keyword":
      return new KeywordClassifier();
    case "step-declare":
      return new StepDeclareClassifier();
    default:
      return new KeywordClassifier();
  }
}

function buildProfiler(config: AxisConfig): Profiler {
  switch (config.profiler) {
    case "domain-override":
      return new DomainOverrideProfiler();
    case "moe-gating":
      return new MoeGatingProfiler();
    case "step-profile":
      return new StepProfiler();
    default:
      return new DomainOverrideProfiler();
  }
}

function buildSelector(config: AxisConfig): Selector {
  const ensembleSize = config.ensembleSize ?? 1;
  switch (config.selector) {
    case "2track-ce":
      return new TwoTrackCeSelector(ensembleSize);
    case "cascade":
      return new CascadeSelector(ensembleSize);
    case "preference":
      return new PreferenceSelector(new PreferenceTable(), ensembleSize);
    case "4strategy":
      return new FourStrategySelector(ensembleSize);
    case "mab":
      return new MabSelector(ensembleSize);
    default:
      return new TwoTrackCeSelector(ensembleSize);
  }
}

function buildDeliberation(config: AxisConfig, chat?: ChatFn): DeliberationProtocol {
  switch (config.deliberation) {
    case "single-best":
      return new SingleBestProtocol();
    case "diverge-synth":
      return new DivergeSynthProtocol();
    case "adp":
      return new AdaptiveDelibProtocol();
    case "free-debate": {
      // FreeDebateProtocol requires a default ChatFn; use provided or a stub
      const defaultChat: ChatFn = chat ?? ((_m, _p) => {
        throw new Error("No chat function provided for free-debate protocol");
      });
      return new FreeDebateProtocol(defaultChat);
    }
    case "role-based":
    default:
      // Pass consensus mode from config to RoleBasedProtocol
      return new RoleBasedProtocol(config.consensus);
  }
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

  const deliberation = buildDeliberation(config, effectiveChat);

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
