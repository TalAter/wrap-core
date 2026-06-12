---
name: llm
description: Why the LLM module is shaped the way it is — conversation-is-the-record, always-structured sends, transient consumption, abort sealing, parse classification, provider taxonomy.
---

# llm internals

`src/llm/` is one deep module: a stateful `Conversation` over a private provider seam. This note records the non-obvious choices; the usage surface is `vault/wrap-core-api/llm.md`, settled decisions with full reasoning are in `vault/impl-specs/llm.md`.

## Conversation is the record

One annotated entry list holds everything — messages, consumer `meta`, and the per-physical-call `Attempt`s core generates itself. There is no notification bus, no `onTrace`/`onAttempt` callback, no mid-call verbose hook: consumers read `entries` after the await. Attempts riding entries is what makes the record self-sufficient for a consumer's own durable log and for resume — and it is why everything in an entry must stay JSON-serializable.

## Always structured

`send` requires a zod schema; there is no text mode. The only unstructured call site in either consumer was wrap's memory init, which hand-parsed lines and is strictly better with a schema. Top-level schemas must be object-shaped because OpenAI strict mode rejects bare strings — prose answers use `{ answer: z.string() }` shapes.

## Transient-once is structural

`beginSend` consumes transients as it assembles — consumption happens when the send *begins*, not when it settles. So "sent with at most one send" holds by construction even when the send throws or aborts, and a second assembly can never resurrect them. The in-send parse retry extends the first assembly locally rather than calling `beginSend` again, which is why both attempts of one send carry the same transients.

## Abort seals synchronously

The entry seals **on the abort event**, not in the rejection handler — the rejection arrives a microtask later, and "aborting seals immediately" is literal: `controller.abort(); chat.send(next)` in one tick must find the in-flight flag already cleared. The abandoned transport keeps a handler attached so its late settle is silently absorbed (no unhandled rejection) and can never mutate the sealed entry — `record` copies the attempts array at seal time, so a late push into the live accumulator hits nothing. Attempts are appended only once a call settles; an aborted call leaves no half-written attempt for the seal to copy.

## Parse classification lives in send, not providers

A provider's whole job is one physical call: return the model's raw text plus wire forensics, or throw a provider error. `send` fence-strips, JSON-parses, schema-validates, classifies (`invalid_json` / `invalid_schema`), and drives the single retry. The ai-SDK flags structured-output failure itself (`NoObjectGeneratedError`); the adapter maps that back to a normal raw-text return so classification stays in one place. `LlmParseError.reason` carries the classification out so consumers never re-derive it by re-parsing `rawText` — a re-parse diverges for fenced responses.

## Test selection is policy; playback is mechanics

Core never names an env var. The test provider is a first-class kind selected by config data (`{ name: "test", responses }`); each consumer keeps its own env convention (`WRAP_TEST_RESPONSE(S)`, `SWEEP_TEST_RESPONSES`) and builds the config itself. A core-read generic env var would silently feed canned responses to every app in that environment. One knowing exception: the ai-SDKs fall back to `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` when no key is passed — upstream behavior, not a core-named contract, and keyless-but-env-keyed configs work through it. Eager validation deliberately does not require an explicit key for API kinds.

That fallback also shapes key hygiene: an env-fallback key never passes through the adapter, so it cannot be declared in `secrets` for scrubbing. What makes the exposure nil is that wire captures are **body-only** — auth headers are never captured in the first place (`ai-sdk.ts`'s `buildWireRequest`). Scrubbing covers the explicitly-configured key; body-only capture covers the rest.

## The retry instruction is core-owned content

A recorded exception to the prompt-text-is-content rule (same standing as `preloadDialogRuntime`): the corrective parse-retry instruction ships with the mechanics because the retry is invisible mechanics. It lives in a plain JSON asset — `src/llm/prompt-constants.json` — not a TS constant, because wrap's Python optimizer reads it via `node_modules/wrap-core/src/llm/prompt-constants.json` for its PROMPT_HASH manifest, a cross-language contract a TS-hosted string cannot honor.

## zod is a peer dependency

Schemas cross the package boundary; two zod copies risk `z.toJSONSchema` over a foreign instance. Peer (plus dev for core's own tests), each consumer lists it too.

## Provider taxonomy

The registry maps names to a `kind` that selects the SDK family; the user-facing name IS the discriminant — no `type` tag. Unknown names default to `openai-compat` so users can point at any compatible endpoint without code changes, but must supply an API key (a silent placeholder against a billed endpoint is unacceptable).

- **`openai` vs `openai-compat` is deliberate.** OpenAI proper speaks the Responses API; its validator rejects multi-turn shapes against non-OpenAI backends, so groq/mistral/ollama/unknown endpoints speak Chat Completions via `@ai-sdk/openai-compatible`.
- **`openrouter` gets its own kind for its first-party SDK.** The generic openai-compatible package can't enable structured outputs for OpenRouter — `supportsStructuredOutputs` is per-provider, but OpenRouter routes to many upstream models with varying capabilities (when false it silently drops the schema, sends `{type: "json_object"}`, and leaks a console.warn). OpenRouter's SDK forwards the `json_schema` response format and lets the upstream apply per-model strictness.
- **`claude-code` flattens the conversation.** The `claude` CLI has no multi-turn input format, so messages flatten into one `User:`/`Assistant:` plaintext prompt. It runs in a tmpdir with session persistence off — never leaks the consumer's cwd into the model's context, writes no disk state. An abort kills the subprocess (real cancellation).
- **OpenAI strict-schema walker.** Strict mode requires every property in `required`; consumer schemas use `.nullable().optional()` (which already yields `anyOf: [type, null]`), so the walker only injects the keys, recursively. Gated per-provider via `supportsStructuredOutputs`; non-strict providers fall back to JSON mode with zod validating.
- **Placeholder key for local endpoints.** OpenAI-compat clients demand a Bearer header even for Ollama/LM Studio; a literal placeholder stands in when no key is configured. Unknown billed endpoints can't hit this — the registry validator requires their key.

Heavy SDK imports (`ai`, `@ai-sdk/*`, `@openrouter/*`) are lazy per the handbook rule — `createLlm` stays synchronous and light; the first physical call pays the import.
