// Real-provider resolution lifted to core from wrap: turn a parsed
// providers config into a `ResolvedProvider`, then into an `Llm`. Core resolves
// only REAL providers — the test-provider sentinel and any model-override
// normalization stay app-side (they ride app env contracts core won't name).
// Errors are bare `LlmConfigError`s reusing the LLM module's class; consumers
// prepend their own voice and remediation.

import { createLlm, type Llm } from "../llm/create-llm.ts";
import { LlmConfigError } from "../llm/errors.ts";
import { getRegistration, type ProviderEntry, validateProviderEntry } from "../llm/registry.ts";

/**
 * The provider-bearing subset of an app config — the only fields core's
 * resolution reads. Apps intersect their own fields (verbose, maxRounds, …)
 * onto this; core ignores them.
 */
export type ProvidersConfig = {
  providers?: Record<string, ProviderEntry>;
  defaultProvider?: string;
};

/**
 * The resolved real provider — what `llmFromResolved` builds core's
 * `LlmConfig` from, and what an app's log entry records as `provider`.
 */
export type ResolvedProvider = {
  name: string;
  /**
   * Final model string. Optional because `claude-code` entries may omit it —
   * the `claude` CLI picks its own default when `--model` is not passed. All
   * other providers must have a model by the time they reach runtime.
   */
  model?: string;
  apiKey?: string;
  baseURL?: string;
};

/**
 * Resolve a parsed config into the real provider it selects.
 *
 * REAL-provider resolution only: no env reads, no test sentinel. Validation
 * runs in the same order as wrap's original resolver — entry existence, then
 * the registry's per-entry validator (so a structurally broken entry, e.g.
 * ollama without baseURL, reports the actionable error before the model
 * check), then the no-model check (skipped for `modelOptional` CLI kinds like
 * claude-code). Every failure throws a bare `LlmConfigError`; the consumer
 * adds its own prefix and "edit ~/.app/config" remediation.
 */
export function resolveProvider(config: ProvidersConfig): ResolvedProvider {
  const providers = config.providers ?? {};
  const providerName = config.defaultProvider;

  if (!providerName) throw new LlmConfigError("no LLM configured.");

  const entry = providers[providerName];
  if (!entry) {
    throw new LlmConfigError(`provider "${providerName}" not found in config.`);
  }

  const validationError = validateProviderEntry(providerName, entry);
  if (validationError) throw new LlmConfigError(validationError);

  const model = entry.model;
  if (!model && !getRegistration(providerName).modelOptional) {
    throw new LlmConfigError(`provider "${providerName}" has no model set in config.`);
  }

  return {
    name: providerName,
    model,
    apiKey: entry.apiKey,
    baseURL: entry.baseURL,
  };
}

/**
 * Build an `Llm` from a resolved real provider. A thin pass to `createLlm`,
 * which resolves `$ENV_VAR` and literal keys and throws `LlmConfigError`
 * itself for anything that could never work — that error propagates bare for
 * the consumer to voice.
 */
export function llmFromResolved(resolved: ResolvedProvider): Llm {
  return createLlm({
    name: resolved.name,
    model: resolved.model,
    apiKey: resolved.apiKey,
    baseURL: resolved.baseURL,
  });
}
