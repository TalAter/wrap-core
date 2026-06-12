// The LLM module's front door: validate a provider config eagerly, hand
// back a label and a conversation factory. Everything behind it (adapter
// seams, send engine, wire scrubbing) stays private.

import { createAiSdkAdapter } from "./ai-sdk.ts";
import { createClaudeCodeAdapter } from "./claude-code.ts";
import { LlmConfigError } from "./errors.ts";
import type { ProviderAdapter, ResolvedProviderConfig } from "./provider.ts";
import { getRegistration, type ProviderEntry, validateProviderEntry } from "./registry.ts";
import { type Conversation, type ConversationOptions, createConversation } from "./send.ts";
import { createTestProvider, type TestResponses } from "./test-provider.ts";

/**
 * Config for a real provider. The consumer writes this from its own config
 * ingestion (decision 12 — config ingestion itself lifts later); core only
 * validates and consumes it.
 */
export type ProviderConfig = { name: string } & ProviderEntry;

/**
 * Canned-playback config — the test provider is a first-class kind selected
 * by name, taking its responses as plain data. Core never reads env vars to
 * pick it (decision 9): test-provider *selection* is consumer policy.
 */
export type TestProviderConfig = { name: "test"; responses: TestResponses };

export type LlmConfig = ProviderConfig | TestProviderConfig;

export interface Llm {
  /** Human-readable "name / model" for verbose lines and UI. */
  readonly label: string;
  /**
   * Open a fresh conversation over this provider. `TMeta` is the consumer's
   * own per-entry payload type, flowing through `add`/`send` annotations.
   */
  startConversation<TMeta = unknown>(options: ConversationOptions): Conversation<TMeta>;
}

/**
 * Resolve the `$ENV_VAR` indirection a consumer wrote into its own config.
 * Core mechanics, not an env contract: core never *names* a variable — it
 * only dereferences the one the consumer named. A missing variable is a
 * config error at creation, not a transport failure mid-conversation.
 */
function resolveApiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.startsWith("$")) {
    const envVar = value.slice(1);
    const resolved = process.env[envVar];
    if (!resolved) throw new LlmConfigError(`environment variable ${envVar} is not set.`);
    return resolved;
  }
  return value;
}

/**
 * Validate eagerly, construct the right adapter. Validation failures are
 * `LlmConfigError` with bare plain-language messages — consumers prepend
 * their own category prefixes. Absent API keys are deliberately legal for
 * API kinds: the ai-SDKs fall back to their own env keys (ANTHROPIC_API_KEY
 * etc. — upstream behavior, decision 9's knowing exception), and keyless
 * local endpoints get a placeholder in the adapter.
 */
function buildAdapter(config: LlmConfig): ProviderAdapter {
  if (config.name === "test") {
    const responses = "responses" in config ? config.responses : undefined;
    if (responses === undefined || (Array.isArray(responses) && responses.length === 0)) {
      // Playback with nothing to play can only ever fail — and it would fail
      // *late*, on the first send (spec: no-responses-configured is a config
      // error at createLlm).
      throw new LlmConfigError(
        'test provider has no responses configured (the name "test" selects canned playback).',
      );
    }
    return createTestProvider(responses);
  }

  // `name === "test"` rules out TestProviderConfig above (its name is the
  // literal), but TS can't discriminate through ProviderConfig's
  // intersection type — assert what control flow already proved.
  const entry = config as ProviderConfig;

  const validationError = validateProviderEntry(entry.name, entry);
  if (validationError) throw new LlmConfigError(validationError);

  const registration = getRegistration(entry.name);
  if (!entry.model && !registration.modelOptional) {
    throw new LlmConfigError(`provider "${entry.name}" requires a model.`);
  }

  const resolved: ResolvedProviderConfig = {
    name: entry.name,
    model: entry.model,
    apiKey: resolveApiKey(entry.apiKey),
    baseURL: entry.baseURL,
  };
  if (registration.kind === "claude-code") return createClaudeCodeAdapter(resolved);
  // Adapter construction is cheap; the heavy SDK imports stay inside its
  // call path (handbook lazy-load rule), so createLlm itself stays light.
  return createAiSdkAdapter(resolved);
}

/**
 * Create an LLM handle: eager config validation now, conversations on
 * demand. Throws `LlmConfigError` for anything that could never work —
 * registry-rule violations, `$ENV_VAR` keys naming unset variables, a
 * missing model on a non-CLI kind, a test config without responses.
 */
export function createLlm(config: LlmConfig): Llm {
  const adapter = buildAdapter(config);
  const model = "model" in config ? config.model : undefined;
  return {
    // "(default)" because CLI-backed kinds may omit the model and let the
    // binary pick its own.
    label: `${config.name} / ${model ?? "(default)"}`,
    startConversation: (options) => createConversation(adapter, options),
  };
}
