---
name: llm
description: Multi-turn structured LLM conversations — createLlm, Conversation (add / send / entries), typed errors, and the provider registry.
package: wrap-core/llm
---

# llm

One capability: have a multi-turn structured conversation with an LLM, with zero consumer knowledge of providers, transports, auth, retries, or wire shapes. `createLlm(config)` validates eagerly and returns a handle; `startConversation` opens a stateful conversation; messages enter only through `add`; `send(schema)` is always structured and resolves to the schema-typed value; `entries` is the annotated, JSON-serializable conversation record. Consumers own the content — system text, schemas, echo predicates, error-voice prefixes — and their own test-provider env contract; core owns everything mechanical. The provider registry rides along for config/wizard surfaces.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `createLlm` | `(config: LlmConfig) => Llm` | Eager validation: throws `LlmConfigError` at creation for anything that could never work — registry-rule violations, a `$ENV_VAR` key naming an unset variable, a missing model on a non-CLI kind, a test config without responses. Cheap to call; heavy SDK imports happen on the first physical call. |
| `LlmConfig` | `ProviderConfig \| TestProviderConfig` | Discriminated by `name`. The name `"test"` is RESERVED — it selects canned playback. Core never reads env vars to pick it: test-provider *selection* is consumer policy (wrap: `WRAP_TEST_RESPONSE(S)`; sweep: `SWEEP_TEST_RESPONSES`). |
| `ProviderConfig` | `{ name: string } & ProviderEntry` | `apiKey` may be a literal or a `$ENV_VAR` indirection — core dereferences the variable the consumer named (missing var = `LlmConfigError`). An absent key is legal for API kinds: the ai-SDKs fall back to their own env keys (`ANTHROPIC_API_KEY` etc.). |
| `TestProviderConfig` | `{ name: "test"; responses: TestResponses }` | Canned playback as plain data. |
| `TestResponse` / `TestResponses` | `string \| Record<string, unknown>`; one or a `readonly` list | A list plays in order, one entry per *physical call* (the in-send parse retry consumes the next entry), and throws on exhaustion. A single response repeats indefinitely. Objects are stringified. An `ERROR:`-prefixed string throws as a provider error. |
| `Llm.label` | `string` | `"name / model"` (`"(default)"` when a CLI kind or the test kind omits the model). For verbose lines and UI. |
| `Llm.startConversation` | `<TMeta>(opts: ConversationOptions) => Conversation<TMeta>` | `TMeta` is the consumer's per-entry payload type — flows through `add`/`send` annotations so reads don't cast. No history/seeding option: resume = re-`add` from your own durable record. |
| `ConversationOptions` | `{ system: string; formatEcho?: EchoPredicate }` | `system` is conversation-level configuration, not an entry. |
| `EchoPredicate` | `(parsed: unknown, rawText: string) => string \| null` | Creation-time domain predicate: what the model sees echoed back as the assistant turn on a schema-valid send (default: raw text). Returning `null` = domain-rejected — the entry keeps its forensics (`attempts`, `parsed`) but is **not replayable**. The internal parse-retry echo never runs through it. |
| `Conversation.add` | `(message: LlmMessage, opts?: AddOptions<TMeta>) => void` | The only way messages enter. Accepts `user` *and* `assistant` roles — consumer-added assistant turns carry few-shot pairs, probe expansions, continuation re-adds. |
| `AddOptions` | `{ meta?: TMeta; transient?: boolean }` | `transient`: sent with at most one send, then never again — consumed the moment that send begins, even if it later throws or aborts. Retained in `entries`, marked `consumed`. `meta` rides the entry; it is never sent to the model. |
| `Conversation.send` | `<S extends ZodType<object>>(schema: S, opts?: SendOptions<TMeta>) => Promise<z.output<S>>` | Always structured — a zod schema is required and the top level must be object-shaped (OpenAI strict mode rejects bare strings; prose answers use `{ answer: z.string() }`). One invisible parse retry (failed raw text echoed + corrective instruction), then `LlmParseError`. A second send while one is in flight throws a plain `Error` — overlap exists only as abort-then-resubmit. |
| `SendOptions` | `{ signal?: AbortSignal; retry?: boolean; meta?: TMeta }` | `retry: false` = exactly one attempt — for consumers that want malformed output as a signal (wrap's eval bridge). `meta` annotates the send-produced entry (it is not a message slot). |
| `Conversation.entries` | `readonly Entry<TMeta>[]` | The append-only, JSON-serializable conversation record. Read it after the await — there are no mid-call callbacks. See *Persisting entries* below before writing it to disk. |
| `Entry` | `{ message, meta?, transient?, consumed?, attempts?, parsed? }` | `message: null` = not replayable (failed, aborted, and echo-rejected sends). `attempts` = per-physical-call forensics. `parsed` = the validated result on successful sends. |
| `replayable` | `<TMeta>(entry: Entry<TMeta>) => entry is Entry<TMeta> & { message: LlmMessage }` | The one replay rule: an entry re-enters a fresh conversation (via `add`) iff its message is non-null and it is not a consumed transient. A type guard — `entries.filter(replayable)` narrows `message` to non-null, so the resume idiom needs no `!`. Free function — replay typically runs over a deserialized record. |
| `LlmMessage` | `{ role: "user" \| "assistant"; content: string }` | No system or tool roles. |
| `Attempt` | `{ request, requestWire?, responseWire?, rawText?, durationMs, error? }` | One physical call: the assembled request (system, messages, JSON-schema descriptor), scrubbed wires, the reply text as the provider returned it (the ai-SDK adapter re-serializes structured output into one uniform raw-text shape; verbatim holds for parse failures, claude-code stdout, and test playback), timing, categorical error. |
| `AttemptRequest` | `{ system, messages, schema? }` | `schema` is a JSON Schema *descriptor* of the live zod schema; absent when not describable. |
| `AttemptError` | `{ kind: "parse" \| "provider"; message: string }` | `parse` = reply text could not become a schema-valid value; `provider` = transport failed before a usable reply existed. |
| `LlmConfigError` | `Error` subclass | Thrown by `createLlm` only — never mid-conversation. |
| `LlmParseError` | `Error` + `{ rawText, reason: "invalid_json" \| "invalid_schema" }` | Carries the raw text so consumers can act on it. `reason` is send's own classification — never re-derive it by re-parsing `rawText` (send fence-strips before classifying; a re-parse diverges). |
| `LlmProviderError` | `Error` + optional `requestWire`/`responseWire` | Transport/provider failure; the failing attempt carries the same wires, scrubbed. |
| `LlmAbortError` | `Error` | The send's signal fired; the entry was sealed at abort time. |
| `WireRequest` / `WireResponse` / `WirePair` | unions on `kind: "http" \| "subprocess" \| "test"` | Public because consumers reading their own durable records need the types: `WireRequest`/`WireResponse` type the per-attempt `requestWire`/`responseWire` fields; `WirePair` is the parameter type of `LlmProviderError`'s constructor and the shape those per-attempt wire fields share. |
| `API_PROVIDERS` / `CLI_PROVIDERS` | `Record<string, ApiProvider>` / `Record<string, CliProvider>` | The provider taxonomy with wizard metadata riding along (display names, key URLs, placeholders, recommended-model regexes, nerd icons, probe commands). Declared order doubles as wizard display order. |
| `getRegistration` | `(name: string) => ProviderRegistration` | Unknown names default to `kind: "openai-compat"` — user-defined OpenAI-compatible endpoints work without code changes. |
| `isKnownProvider` / `isCliProvider` | `(name: string) => boolean` | Built-in registration checks. |
| `providerNeedsApiKey` | `(name: string) => boolean` | True for API providers publishing an `apiKeyUrl` — drives the wizard's key screen. |
| `validateProviderEntry` | `(name: string, entry: ProviderEntry) => string \| null` | Bare plain-language error or `null`. Unknown providers must supply `baseURL`, `apiKey`, and `model` — no silent placeholder against a billed endpoint. |
| `ProviderEntry` / `ProviderKind` / `ProviderRegistration` / `ApiProvider` / `CliProvider` | types | `ProviderEntry` (`apiKey? baseURL? model?`) is the minimal shape the registry validates; consumer config entry types stay structurally compatible. |

## Persisting entries

**Persisting `entries` durably persists (scrubbed) wire bodies.** Every send appends `Attempt`s carrying the assembled request and body-only wire captures. Core scrubs API keys before wires land, but prompt and response bodies arrive intact — trace gating is the consumer's job *at serialization time*, not core's at send time. Wrap's `toAttemptMeta` (`wrap/src/core/round.ts`) is the live example: `request` and wires copied into the on-disk record only under `logTraces`; `raw_response` always kept on parse failure. Sweep's analysis resume story hits this first — persisting the conversation for later follow-ups persists the wire record with it.

## Errors and voice

All four error types carry **bare** plain-language messages with no category prefix — voice is content, so consumers prepend their own (wrap's `Config error:` / `LLM error (label):`, sweep's `sweep:`).

## Abort semantics

Aborting **seals the entry immediately and synchronously** — attempts so far, no replayable message — and the transport's eventual result is discarded internally. `controller.abort(); chat.send(next)` in the same tick is sanctioned: abort-then-resubmit is the only legal overlap. A signal that fired *before* the send means the send never starts — no transient consumption, no entry. Entries carry **no abort discriminator**: an aborted entry is indistinguishable from any other null-message entry, by design; consumers needing the distinction record it themselves (in `meta`, or their own log).

## Usage

```ts
import { createLlm, replayable } from "wrap-core/llm";
import { z } from "zod";

const llm = createLlm({ name: "anthropic", model: "claude-sonnet-4-5", apiKey: "$ANTHROPIC_API_KEY" });
const chat = llm.startConversation<MyMeta>({ system: SYSTEM, formatEcho });

chat.add({ role: "user", content: query }, { meta: { kind: "query" } });
chat.add({ role: "user", content: liveContext }, { transient: true }); // this send only
const result = await chat.send(z.object({ answer: z.string() }), { signal });

persist(chat.entries);                       // mind the wire bodies — gate traces here
seed.filter(replayable).forEach((e) => fresh.add(e.message)); // resume — the guard narrows message
```

## Pitfalls

- **`ZodType<object>` doesn't catch everything.** Top-level arrays and root unions type-check (TS counts `string[]` as `object`) but surface as provider errors from the strict-schema transform. Keep top-level schemas object-shaped.
- **Transients are consumed even when the send throws or aborts.** A later send never resurrects them — re-add whatever still applies (wrap's scratchpad retry re-adds its directives every send).
- **No seeding constructor.** Resume/continuation = map your own durable record back into `add`s, skipping non-`replayable` entries and applying fresh per-invocation framing.
- **`zod` is a peer dependency.** Each consumer lists it; two zod copies risk `z.toJSONSchema` over a foreign instance.
- **Echo rejection ≠ failure.** A `formatEcho` returning `null` still resolves the send with the parsed value — it only keeps the response out of replay. If the conversation continues, the consumer `add`s the settled echo explicitly.

Internals rationale (why conversation-is-the-record, abort sealing, provider taxonomy, the retry-instruction exception): `vault/llm.md`.
