// ai-SDK adapter — one factory dispatching the anthropic / openai /
// openrouter / openai-compat kinds onto the matching SDK package. Private
// sibling: consumers reach it only through `createLlm`.
//
// ALL SDK imports (`ai`, `@ai-sdk/*`, `@openrouter/*`) are lazy — `await
// import` inside the call paths — per the handbook's heavy-dep rule: the SDK
// barrels carry a large transitive graph, and `wrap-core/llm`'s index must
// stay importable without paying their parse cost. Only types cross the
// module top level.

import type { LanguageModel, Schema } from "ai";
import { type ZodType, z } from "zod";
import { LlmConfigError, LlmProviderError } from "./errors.ts";
import type { ProviderAdapter, ResolvedProviderConfig } from "./provider.ts";
import { getRegistration } from "./registry.ts";
import type { WirePair, WireRequest } from "./wires.ts";

/**
 * Taxonomy rationale (carried from wrap's vault):
 *
 * `openai-compat` speaks Chat Completions (via `@ai-sdk/openai-compatible`)
 * rather than the Responses API — OpenAI's Responses validator rejects
 * multi-turn shapes against non-OpenAI backends (groq, mistral, …), so only
 * openai proper keeps the Responses API.
 *
 * `openrouter` has its own first-party SDK provider that forwards
 * `response_format: json_schema` and lets the upstream model apply per-model
 * strictness (the generic openai-compatible package silently drops the
 * schema and only sends `{type: "json_object"}` when
 * `supportsStructuredOutputs` is false, which also leaks a console.warn).
 */
export async function buildModel(config: ResolvedProviderConfig): Promise<LanguageModel> {
  const { name, model, apiKey, baseURL } = config;
  if (!model) throw new LlmConfigError(`provider "${name}" requires a model.`);
  const reg = getRegistration(name);
  switch (reg.kind) {
    case "anthropic": {
      const { createAnthropic } = await import("@ai-sdk/anthropic");
      return createAnthropic({ apiKey, baseURL })(model);
    }
    case "openai": {
      const { createOpenAI } = await import("@ai-sdk/openai");
      return createOpenAI({ apiKey, baseURL })(model);
    }
    case "openrouter": {
      const { createOpenRouter } = await import("@openrouter/ai-sdk-provider");
      return createOpenRouter({ apiKey, baseURL }).chat(model);
    }
    case "openai-compat": {
      if (!baseURL) throw new LlmConfigError(`provider "${name}" requires baseURL.`);
      const { createOpenAICompatible } = await import("@ai-sdk/openai-compatible");
      // Local endpoints (Ollama, LM Studio) skip auth; the SDK still demands
      // a Bearer header, so a literal placeholder stands in when no key is
      // configured. Unknown billed endpoints can't hit this: the registry
      // validator requires an apiKey for unknown names.
      return createOpenAICompatible({
        name,
        apiKey: apiKey ?? "nokey",
        baseURL,
        supportsStructuredOutputs: reg.supportsStructuredOutputs,
      })(model);
    }
    case "claude-code":
      // Plain Error (send's overlap-throw precedent): createLlm routes CLI
      // kinds to the claude-code adapter, so reaching here is a
      // programming-contract violation, never an operational config outcome.
      throw new Error(`"${name}" is a CLI provider, not an AI SDK model.`);
  }
}

/**
 * OpenAI strict mode requires every property in `required`. Consumer zod
 * schemas use .nullable().optional() for optional fields, so the JSON schema
 * already carries anyOf: [type, null] — the walker only has to add every key
 * to `required`, recursively.
 */
export async function toOpenAIStrictSchema(zodSchema: ZodType): Promise<Schema> {
  const { jsonSchema } = await import("ai");
  const raw = structuredClone(z.toJSONSchema(zodSchema)) as Record<string, unknown>;
  addAllToRequired(raw);
  return jsonSchema(raw, {
    validate: (value) => {
      const result = zodSchema.safeParse(value);
      if (result.success) return { success: true as const, value: result.data };
      return { success: false as const, error: result.error as Error };
    },
  });
}

function addAllToRequired(node: Record<string, unknown>): void {
  if (node.type === "object" && node.properties) {
    const props = node.properties as Record<string, Record<string, unknown>>;
    node.required = Object.keys(props);
    for (const child of Object.values(props)) addAllToRequired(child);
  }
  if (node.items) addAllToRequired(node.items as Record<string, unknown>);
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(node[key])) {
      for (const child of node[key] as Record<string, unknown>[]) addAllToRequired(child);
    }
  }
}

/**
 * Body-only wire capture — never headers. This property is load-bearing for
 * key hygiene: when an SDK falls back to its own env key (ANTHROPIC_API_KEY,
 * OPENAI_API_KEY) the adapter never sees the value and cannot declare it in
 * `secrets`, so what makes the env-fallback exposure nil is that the
 * Authorization header is never captured in the first place — not scrubbing.
 *
 * `system` and `messages` are stripped from the request body: they duplicate
 * the attempt's own `request` record. What remains is the SDK-added delta
 * (model, max_tokens, tools, tool_choice, response_format, …). Trade-off:
 * cache_control markers live on the stripped system blocks; cache debugging
 * falls back to `responseWire.usage`. Returns `undefined` when the body is
 * absent or not an object — forensics are best-effort and never fail a call.
 */
export function buildWireRequest(raw: unknown): WireRequest | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { system: _s, messages: _m, ...rest } = raw as Record<string, unknown>;
  return { kind: "http", body: rest };
}

type SdkCallResult = {
  request?: { body?: unknown };
  response?: { body?: unknown };
  usage?: unknown;
  finishReason?: string;
};

/** Pull body-only wires off a settled `generateText` result. */
function wiresFromResult(result: SdkCallResult): WirePair {
  try {
    const wires: WirePair = {};
    const requestWire = buildWireRequest(result.request?.body);
    if (requestWire) wires.requestWire = requestWire;
    wires.responseWire = {
      kind: "http",
      body: result.response?.body,
      usage: result.usage,
      finishReason: result.finishReason,
    };
    return wires;
  } catch {
    // Wire capture must never break the call.
    return {};
  }
}

export function createAiSdkAdapter(config: ResolvedProviderConfig): ProviderAdapter {
  const strictSchema = getRegistration(config.name).supportsStructuredOutputs === true;
  // Memoized so the SDK import + model construction happen once, on the
  // first physical call — `createLlm` stays synchronous and light.
  let modelPromise: Promise<LanguageModel> | undefined;
  const getModel = () => {
    modelPromise ??= buildModel(config);
    return modelPromise;
  };

  return {
    // The explicitly-configured key (post-$ENV resolution) is declared so
    // `send` scrubs it out of wires and error messages. SDK env-fallback
    // keys are unseen here — covered by the body-only capture rule above.
    secrets: config.apiKey ? [config.apiKey] : undefined,

    async call(request, opts) {
      const { generateText, Output, NoObjectGeneratedError, APICallError } = await import("ai");
      const model = await getModel();
      const schema = strictSchema ? await toOpenAIStrictSchema(request.schema) : request.schema;
      // LlmMessage's union-typed role doesn't narrow into the SDK's
      // discriminated message union — re-tag per role.
      const messages = request.messages.map((m) =>
        m.role === "user"
          ? ({ role: "user", content: m.content } as const)
          : ({ role: "assistant", content: m.content } as const),
      );

      try {
        const result = await generateText({
          model,
          system: request.system,
          messages,
          output: Output.object({ schema }),
          // Real cancellation: the SDK aborts the HTTP request in flight.
          abortSignal: opts?.signal,
        });
        const wires = wiresFromResult(result);
        // ai v6: `result.output` is a getter that THROWS
        // NoOutputGeneratedError when no output exists (e.g. finishReason
        // "length") — read it inside a try so the just-built wires ride on
        // the typed error instead of being lost to the generic catch below.
        let output: unknown;
        try {
          output = result.output;
        } catch {
          throw new LlmProviderError("Model returned no structured output.", wires);
        }
        // The model's reply, re-serialized from the SDK's parsed output:
        // tool-mode providers (anthropic) have no raw JSON text apart from
        // the tool args, so this is the one uniform raw-text shape.
        return { text: JSON.stringify(output), ...wires };
      } catch (error) {
        if (error instanceof LlmProviderError) throw error;
        // The SDK flags structured-output failure itself, but parse
        // classification belongs to `send` (provider.ts invariant) — map the
        // flagged failure back to a normal raw-text reply. No wires on this
        // path: the error exposes response metadata with headers, not a
        // body-only capture.
        if (NoObjectGeneratedError.isInstance(error)) {
          return { text: error.text ?? "" };
        }
        const wires: WirePair = {};
        if (APICallError.isInstance(error)) {
          // Body-only here too: requestBodyValues/responseBody, no headers.
          const requestWire = buildWireRequest(error.requestBodyValues);
          if (requestWire) wires.requestWire = requestWire;
          if (error.responseBody !== undefined) {
            wires.responseWire = { kind: "http", body: error.responseBody };
          }
        }
        throw new LlmProviderError(error instanceof Error ? error.message : String(error), wires);
      }
    },
  };
}
