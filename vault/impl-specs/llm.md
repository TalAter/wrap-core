---
name: llm-impl-spec
description: Build spec — promote wrap's LLM provider capability into wrap-core/llm as a single conversation abstraction consumed by wrap and sweep.
---

# Promotion: `wrap-core/llm`

> **Status:** Implemented. Shipped as `wrap-core/llm` with both consumers wired; docs delivered. The only open work is the post-merge sequencing checklist (the "Sequencing beyond `bun run check`" section below). This spec remains as the historical record of the decisions and their reasons.

Promote wrap's LLM capability (`wrap/src/llm/` plus pieces of `wrap/src/core/`) into a deep core module. Consumers get one capability — *have a multi-turn conversation with an LLM* — and zero knowledge of providers, transports, auth, retries, or wire shapes.

**How to read this spec.** It records the decisions made in planning and *why* — so a reader can honor intent, not follow steps. The orientation/walkthrough material it once carried is now embodied in code and vault notes (pointers below); the settled decisions and the semantics they pinned are what remain.

**Demand:** sweep's install-script analysis (the step-5 seam in `sweep/src/installer/install.ts`) needs multi-turn conversations — an analysis, then user follow-up questions continuing the same thread, with the turns durable enough to resume later.

## Philosophy

**This is a refactor, not an extraction.** Moving wrap's files into core and renaming would be a failure even if everything passed. Wrap's pre-promotion shape was full of artifacts of its own history — a stateless `runPrompt` re-fed by whole-transcript re-projection every round, wire capture smuggled through a notification bus, the retry ladder living in round.ts while parse-failure classification was split across providers — and none of that shape was the capability. The promotion reshaped the code into the capability itself: core ends up *cleaner than the original*, with wrap-specific couplings lifted to parameters or dissolved entirely.

**The module must be deep**: a small, intent-revealing surface — create a provider, start a conversation, add messages, send, read the record — hiding all the machinery (SDK dispatch, request shaping, auth, strict-schema transforms, parse retries, wire capture, conversation state). The handbook's mechanics/content split applies verbatim (see `vault/README.md`): core owns the mechanics; consumers own prompt text, schemas, and the domain predicates only they can answer. The test for shallowness: if wrap or sweep ends up orchestrating internal steps — building SDK models, parsing wire formats, driving retry ladders — or if provider/transport details leak into a consumer, the abstraction failed.

Depth is a guideline, not a hill to die on. A sliver of exposed mechanics that genuinely earns its place by simplifying callers is acceptable (the way `preloadDialogRuntime()` does) — record why at the surface.

## Settled decisions

These were argued out in planning. Each carries its reason; if future work invalidates a reason, surface it rather than silently complying or silently diverging.

1. **One abstraction — a stateful `Conversation` — for both consumers. No stateless lower tier.** Wrap's "re-project the whole transcript every call" was an artifact, not a requirement: a turn can be *framed* into its message by the consumer when it is **added**; core merely *assembles* the accumulated messages at send time. (Two distinct operations — this spec avoids the word "projection" for either.) One-shot calls (wrap's memory init) are just one-entry conversations. Don't reintroduce a two-level API.

2. **`send` is always structured — a Zod schema is required, no text mode.** The only unstructured call site in either tool was wrap's memory init, which hand-parsed lines and is strictly better with a schema. Note: top-level schemas must be objects (OpenAI strict mode rejects bare strings), so prose answers use `{ answer: z.string() }`-shaped schemas.

3. **The conversation is the record.** One annotated entry list holds everything: messages, consumer metadata, and the per-physical-call attempt records (request, scrubbed wires, timing, errors) that core generates itself. This replaces both wrap's transcript-as-log dual role and the `llm-wire` notification bus that providers used to emit mid-call. Consumers read the record after the await; there is no `onTrace`/`onAttempt` callback and no mid-call verbose hook (consciously dropped — wrap's mid-ladder `verbose("LLM parse error, retrying...")` line died with it; nothing pinned it).

4. **Messages enter only through `add`; `send` takes no message.** A message slot on `send` would be a second, sneaky way to add messages. Corollary: transience (decision 5) is an `add`-time flag, not a `send` option.

5. **Transient = sent with at most one send, then never again — but retained in the record, marked.** Covers wrap's live temp-dir listing, last-round instruction, and scratchpad-retry echo pair, whose defining property is "never enters the persistent transcript." Consumed whether the send resolves or throws. A consumer replaying its record into `add`s skips consumed transients — the retained flag exists to enable exactly that. A later send does not resurrect consumed transients: wrap's scratchpad second send re-adds whatever still applies.

6. **Append-only. No retroactive editing or re-flagging of entries.** No call site in either tool needs it (history that explains past turns — like a changed cwd — is context, not noise). The entry-flag shape leaves room to add exclusion later as a small additive change.

7. **No constructor history/seeding option.** Resuming = re-adding messages through `add`. One way to do things; continuation and resume are the consumer mapping its own durable log back into adds, applying fresh per-invocation framing as it does so.

8. **Parse-failure retry lives inside `send`: exactly one retry** (echo failed raw text + corrective instruction), then a typed error carrying the raw text. "Retry once, not loop" — looping hides real breakage behind cost. Invisible by default — with a per-send opt-out (`{ retry: false }`): wrap's eval bridge deliberately calls once with **no** retry (malformed output is its optimization signal). The corrective instruction text is core-owned default content (wrap's `jsonRetryInstruction` verbatim) — a **recorded exception** to the handbook's prompt-text-is-content rule, same standing as `preloadDialogRuntime`. That string is also read by wrap's optimizer for its PROMPT_HASH manifest, and Python can't read a TS-hosted string — so it ships as a JSON asset (`src/llm/prompt-constants.json`) the optimizer reads via `node_modules/wrap-core`; a silently dead mirror (key left behind in wrap's constants) was not acceptable. Wrap's *scratchpad* retry is domain logic and stayed in wrap — a second send with a transient echo pair (see decision 5, and the echo-returns-`null` semantics for keeping the rejected response out of replay).

9. **Core defines no env-var contract of its own. Test-provider selection is consumer policy; playback is core mechanics.** Core never *names* an env var (no `LLM_TEST_RESPONSE`, no implicit key lookup) — but resolving the explicit `$ENV_VAR` indirection a consumer wrote into its own config is core mechanics and fine. The test provider is a first-class provider kind taking its canned responses as plain data. Consumers keep their own env conventions (`WRAP_TEST_RESPONSE(S)`; sweep's `SWEEP_TEST_RESPONSES`) and build the config themselves. Reason: a core-read generic env var would silently feed canned responses to every app in that environment; subprocess e2e still works because the consumer owns the env contract. One knowing exception: the ai-SDKs themselves fall back to `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` when no key is passed — upstream provider behavior, not a core-named env var, and keyless-but-env-keyed user configs work through it. Eager validation must not start requiring an explicit key for API kinds.

10. **The provider registry moves whole, wizard metadata included** (key URLs, placeholders, recommended-model regexes, icons, probe commands). It's provider knowledge, not wrap voice; "add a provider = edit one file" survives; sweep will ingest config the same way when that lifts to core later.

11. **`zod` is a wrap-core peer dependency** (plus dev for core's own tests). Schemas cross the package boundary; two zod copies risk `z.toJSONSchema` over a foreign instance. (The handbook's settled-decisions list was updated in the same promotion.)

12. **Hardcoded provider config this version.** Config ingestion (and `parseModelOverride`) lifts to core in a future promotion. Wrap's `resolve-provider.ts` stays in wrap for now — its output shape already matches what core consumes.

13. **No streaming.** Not needed by either consumer at the moment.

## Surface semantics (as shipped)

The module lives at `src/llm/`, exported as `wrap-core/llm`. The shipped surface is documented in `vault/wrap-core-api/llm.md`; internals rationale in `vault/llm.md`. Naming latitude resolved as: `entries` (not `log` — collides with wrap's JSONL "Log" glossary term), `formatEcho` (not `echo` — reads like a boolean at the call site), `replayable` as the one replay predicate.

Semantics pinned in planning, preserved in the implementation:

- **Assembly order** = add order; a send assembles every non-consumed entry's message into the request.
- **`add` accepts user and assistant roles.** Consumer-added assistant turns are load-bearing: few-shot pairs, wrap's probe expansion (assistant command + user output), continuation re-adds, the scratchpad echo pair. (System/tool roles stay out — see non-goals.)
- **`meta`** is an opaque consumer payload riding alongside the message core sends — what makes the record self-sufficient for the consumer's own durable log and for resume. Typed through a generic (`startConversation<TMeta>`). Send-produced entries may carry `meta` too — that annotates the entry, it isn't a message slot, so decision 4 holds.
- **`formatEcho`** is a creation-time domain predicate `(parsed, rawText) => string | null`: what the model sees echoed back as the assistant turn (default: raw text). Only the consumer knows this — wrap strips fields to save tokens and prevent scratchpad misuse. Returning `null` records the entry (attempts, parsed) with **no replayable message** — a schema-valid but domain-rejected response must never enter replay; the consumer `add`s the round's settled echo explicitly. The internal parse-retry echo is raw text verbatim and does not run through this predicate.
- **Failed and aborted sends** leave an entry with attempts and no replayable message — forensics preserved, replay clean; otherwise the next follow-up on the same conversation would replay a stale assistant turn. The abort case is new capability, not parity: `send` takes a signal; aborting seals the entry immediately and the transport's eventual result is discarded internally — wrap's Esc→compose→resubmit flow means a new send can start while an abandoned call is still settling, and core tolerates that. (A second `send` while one is in flight *without* an abort throws — overlap exists only as abort-then-resubmit.) A replaying consumer skips two things — consumed transients and null-message entries — exposed as the single `replayable` predicate.
- **Errors** are core-typed (parse errors carry the raw text — replaces wrap's sniffing of the ai-SDK's `NoObjectGeneratedError`), with bare plain-language messages; consumers apply their own category prefixes (wrap's `Config error:` / `LLM error (label):`, sweep's `sweep:` invariant) — voice is content, so it stays consumer-side. Eager validation at `createLlm` (registry rules, `$ENV_VAR` key resolution, model required unless the kind is CLI-backed).
- **API keys are scrubbed by core** before wires land in the record. Trace-verbosity gating (wrap's `logTraces`) stays consumer policy at serialization time.
- **Test playback semantics**: a response list (strings or JSON objects; objects are stringified) plays in order and throws on exhaustion; a single response repeats indefinitely; an `ERROR:`-prefixed response throws as a provider error. The list advances per physical call (an in-send retry consumes the next entry). Two pinned contracts shifted *consciously*: an invalid canned response now produces two attempts ending in a parse-kind error (core classifies what the old test provider self-parsed), and wrap's echo-the-last-user-message fallback died — it existed only for the schemaless path decision 2 abolished, so no-responses-configured is a config error at `createLlm`.

## Where it landed

- Core: `wrap-core/src/llm/` (`index.ts` is the surface; siblings private). Usage doc `vault/wrap-core-api/llm.md`; internals note `vault/llm.md`.
- Wrap: `wrap/src/llm/` (scaffold, framing, env contract, provider resolution) + `src/core/round.ts` (domain retries, JSONL record derivation); rationale in wrap's `vault/llm.md`. The eval bridge (`wrap/eval/bridge.ts`) sends with `retry: false` and recovers assemble-mode output from a test-provider conversation's attempt forensics; its stdout taxonomy (`ok` / `invalid_json` / `invalid_schema` / `provider_error`) remains a cross-language contract with `optimize.py`.
- Sweep: `sweep/src/installer/analyze.ts` — env-gated analysis seam behind `SWEEP_TEST_RESPONSES`; strict no-op for real installs until a production provider flips on.

## Sequencing beyond `bun run check`

> **Status:** Pending.

Consumer lockfiles pin `wrap-core` to a GitHub sha (`github:…#main`); the Bun workspace is local-dev plumbing only. So checks stay green throughout while anything installing from lockfiles breaks silently until core is pushed and consumers re-pin: wrap's `optimize` Docker image (`bun install --frozen-lockfile`; mounts `src/` but not `node_modules`) and each consumer's standalone CI. Order at the end: core merges/pushes first; then each consumer refreshes its lockfile's `github:` resolution standalone — note the manifests pin `"wrap-core": "0.0.1"` while the lock holds the `github:…` resolution, so a naive `bun update` may no-op; verify the lock's sha actually moved — then consumer branches merge; rebuild the optimize image after the re-pin (a temporary wrap-core source mount into the container is fine for local iteration). No in-repo check covers this — run the optimizer once after the flip to verify.

## Docs deliverables

> **Status:** Done.

- `vault/wrap-core-api/llm.md` — consumer usage doc, including the mandatory statement: persisting entries durably persists (scrubbed) wire bodies — trace gating is the consumer's job at serialization time; sweep's resume story hits this first.
- `vault/llm.md` — internals note (conversation-is-the-record, always-structured, test-selection-as-policy, abort sealing, the decision-8 exception) plus the provider-taxonomy rationale carried over from wrap's vault.
- Wrap's `vault/llm.md` — stub pointing into core for moved concerns; wrap-side notes rewritten for add-time framing.

## Non-goals

Streaming; config-ingestion lift; mid-call observability callbacks; retroactive entry mutation; system/tool roles in messages; retry-instruction *text* override (the per-send retry opt-out shipped — decision 8); new providers (the google TODO stays a TODO).
