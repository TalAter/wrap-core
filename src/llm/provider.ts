// Internal provider seam — what every provider kind (ai-sdk, claude-code
// subprocess, test playback) implements, and the only thing `send` knows
// about a provider. Private sibling: the public `createLlm` factory that
// constructs adapters lands in a later promotion unit.
//
// Invariant (vault/impl-specs/llm.md, decisions 3 & 8): parse-failure
// classification lives in `send`, NOT in providers. A provider's job is one
// physical call: return the model's raw text plus wire forensics, or throw
// a transport/provider error. An adapter whose SDK flags structured-output
// failure itself (the ai-SDK's NoObjectGeneratedError-with-text) maps that
// to a normal raw-text return so `send` classifies it as a parse failure.

import type { ZodType } from "zod";
import type { LlmMessage } from "./conversation.ts";
import type { WirePair } from "./wires.ts";

/**
 * One physical call's input. `system` is conversation-level configuration,
 * not an entry. `schema` is the live zod schema — adapters that support
 * structured output use it to shape the wire request (json_schema response
 * format, strict-mode transforms); they never parse with it.
 */
export type ProviderRequest = {
  system: string;
  messages: readonly LlmMessage[];
  schema: ZodType<object>;
};

/** A settled call: raw text exactly as the model produced it, plus wires. */
export type ProviderReply = WirePair & {
  text: string;
};

export interface ProviderAdapter {
  /**
   * Execute one physical model call. Throws `LlmProviderError` (anything
   * else is wrapped by `send`) on transport/provider failure. `signal` lets
   * real transports cancel; adapters may ignore it — `send` discards late
   * results either way.
   */
  call(request: ProviderRequest, opts?: { signal?: AbortSignal }): Promise<ProviderReply>;
  /**
   * Secrets (API keys) that must never reach persisted entries. `send`
   * scrubs these out of wires before attempts land — adapters only have to
   * declare them, not scrub.
   *
   * Declared secrets are necessarily incomplete: when an SDK falls back to
   * its own env key (ANTHROPIC_API_KEY etc.), the adapter never sees the
   * value and can't declare it. Adapters must therefore keep wire captures
   * body-only (no auth headers) — that, not scrubbing, is what makes the
   * env-fallback exposure nil.
   */
  secrets?: readonly string[];
}
