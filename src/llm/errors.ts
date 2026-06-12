// Core-typed errors for the LLM module. Messages are bare plain language —
// no category prefixes ("Config error:", "LLM error:"): voice is content,
// so consumers apply their own prefixes. See vault/impl-specs/llm.md,
// surface-sketch "Errors".

import type { WirePair, WireRequest, WireResponse } from "./wires.ts";

/**
 * The provider config handed to `createLlm` cannot work: registry rules
 * failed, a `$ENV_VAR` apiKey names an unset variable, a required model is
 * missing, or a test config carries no responses. Raised eagerly at
 * `createLlm` — never mid-conversation — so a misconfigured consumer fails
 * at startup, not on its first send.
 */
export class LlmConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmConfigError";
  }
}

/**
 * The model's reply could not be turned into a schema-valid value — invalid
 * JSON or a schema mismatch. Carries the raw text so consumers can act on
 * it (wrap's eval bridge treats malformed output as its optimization
 * signal). Replaces wrap's sniffing of the ai-SDK's NoObjectGeneratedError.
 *
 * `reason` is send's own classification, carried so consumers (wrap's eval
 * bridge) never re-derive it by re-parsing `rawText` — a re-parse diverges
 * for fenced responses, which send strips before classifying.
 */
export class LlmParseError extends Error {
  constructor(
    message: string,
    readonly rawText: string,
    readonly reason: "invalid_json" | "invalid_schema",
  ) {
    super(message);
    this.name = "LlmParseError";
  }
}

/**
 * The transport/provider failed before a usable reply existed. Providers
 * attach wire forensics when they have them; `send` copies the wires into
 * the failing attempt (scrubbed) before rethrowing.
 */
export class LlmProviderError extends Error {
  readonly requestWire?: WireRequest;
  readonly responseWire?: WireResponse;

  constructor(message: string, wires?: WirePair) {
    super(message);
    this.name = "LlmProviderError";
    if (wires?.requestWire) this.requestWire = wires.requestWire;
    if (wires?.responseWire) this.responseWire = wires.responseWire;
  }
}

/** A send's signal fired. The entry was sealed at abort time. */
export class LlmAbortError extends Error {
  constructor() {
    super("Send aborted.");
    this.name = "LlmAbortError";
  }
}
