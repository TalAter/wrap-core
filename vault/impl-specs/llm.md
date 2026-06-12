---
name: llm-impl-spec
description: Build spec — promote wrap's LLM provider capability into wrap-core/llm as a single conversation abstraction consumed by wrap and sweep.
---

# Promotion: `wrap-core/llm`

Promote wrap's LLM capability (`wrap/src/llm/` plus pieces of `wrap/src/core/`) into a deep core module. Consumers get one capability — *have a multi-turn conversation with an LLM* — and zero knowledge of providers, transports, auth, retries, or wire shapes.

**How to read this spec.** It records the decisions made in planning and *why* — so the implementer can honor intent, not follow steps. Everything below the Settled Decisions section is orientation: sketches, pointers, expected consequences. The implementer has better context than this spec once the code is open; adapt the plan as realities become clearer. Deviating from a sketch is normal; deviating from a settled decision deserves a stop-and-surface.

**Demand:** sweep's install-script analysis (the step-5 seam in `sweep/src/installer/install.ts`) needs multi-turn conversations — an analysis, then user follow-up questions continuing the same thread, with the turns durable enough to resume later.

## Philosophy

**This is a refactor, not an extraction.** Moving wrap's files into core and renaming would be a failure even if everything passed. Wrap's current shape is full of artifacts of its own history — a stateless `runPrompt` re-fed by whole-transcript re-projection every round, wire capture smuggled through a notification bus, the retry ladder living in round.ts while parse-failure classification is split across providers — and none of that shape is the capability. The promotion reshapes the code into the capability itself: core ends up *cleaner than the original*, with wrap-specific couplings lifted to parameters or dissolved entirely. Several settled decisions below exist precisely because planning found wrap's current mechanics to be incidental, not essential; expect to find more of those while implementing, and treat them the same way.

**The module must be deep**: a small, intent-revealing surface — create a provider, start a conversation, add messages, send, read the log — hiding all the machinery (SDK dispatch, request shaping, auth, strict-schema transforms, parse retries, wire capture, conversation state). The handbook's mechanics/content split applies verbatim (see `vault/README.md`): core owns the mechanics; consumers own prompt text, schemas, and the domain predicates only they can answer. The test for shallowness: if wrap or sweep ends up orchestrating internal steps — building SDK models, parsing wire formats, driving retry ladders — or if provider/transport details leak into a consumer, the abstraction failed. Consumers should ask for what they want the way they call `openDialog()`, not run the Ink internals.

Depth is a guideline, not a hill to die on. A sliver of exposed mechanics that genuinely earns its place by simplifying callers is acceptable (the way `preloadDialogRuntime()` does) — record why at the surface.

## Settled decisions

These were argued out in planning. Each carries its reason; if implementation invalidates a reason, surface it rather than silently complying or silently diverging.

1. **One abstraction — a stateful `Conversation` — for both consumers. No stateless lower tier.** Wrap's "re-project the whole transcript every call" is an artifact, not a requirement: a turn can be *framed* into its message by the consumer when it is **added**; core merely *assembles* the accumulated messages at send time. (Two distinct operations — this spec avoids the word "projection" for either.) One-shot calls (wrap's memory init) are just one-entry conversations. Don't reintroduce a two-level API.

2. **`send` is always structured — a Zod schema is required, no text mode.** The only unstructured call site in either tool was wrap's memory init, which hand-parsed lines and is strictly better with a schema. Note: top-level schemas must be objects (OpenAI strict mode rejects bare strings), so prose answers use `{ answer: z.string() }`-shaped schemas.

3. **The conversation is the record.** One annotated entry list holds everything: messages, consumer metadata, and the per-physical-call attempt records (request, scrubbed wires, timing, errors) that core generates itself. This replaces both wrap's transcript-as-log dual role and the `llm-wire` notification bus that providers currently emit mid-call. Consumers read the log after the await; there is no `onTrace`/`onAttempt` callback and no mid-call verbose hook (consciously dropped — wrap's mid-ladder `verbose("LLM parse error, retrying...")` line dies with it; nothing pins it).

4. **Messages enter only through `add`; `send` takes no message.** A message slot on `send` would be a second, sneaky way to add messages. Corollary: transience (decision 5) is an `add`-time flag, not a `send` option.

5. **Transient = sent with at most one send, then never again — but retained in the log, marked.** Covers wrap's live temp-dir listing, last-round instruction, and scratchpad-retry echo pair, whose defining property today is "never enters the persistent transcript." Consumed whether the send resolves or throws. A consumer replaying its log into `add`s skips consumed transients — the retained flag exists to enable exactly that. A later send does not resurrect consumed transients: wrap's scratchpad second send must re-add whatever still applies (today's scratchpad-retry input also carries the live context and last-round instruction, not just the echo pair).

6. **Append-only. No retroactive editing or re-flagging of entries.** No call site in either tool needs it (history that explains past turns — like a changed cwd — is context, not noise). The entry-flag shape leaves room to add exclusion later as a small additive change.

7. **No constructor history/seeding option.** Resuming = re-adding messages through `add`. One way to do things; continuation and resume are the consumer mapping its own durable log back into adds, applying fresh per-invocation framing as it does so.

8. **Parse-failure retry lives inside `send`: exactly one retry** (echo failed raw text + corrective instruction), then a typed error carrying the raw text. "Retry once, not loop" — looping hides real breakage behind cost. Invisible by default — but one consumer already demands an opt-out: wrap's eval bridge deliberately calls once with **no** retry (malformed output is its optimization signal), so a per-send opt-out (e.g. `{ retry: false }`) is sanctioned. The corrective instruction text becomes core-owned default content (wrap's `jsonRetryInstruction` verbatim) — a **recorded exception** to the handbook's prompt-text-is-content rule, same standing as `preloadDialogRuntime`; note it at the surface. That string is also read by wrap's optimizer for its PROMPT_HASH manifest (`eval/dspy/optimize.py` reads `jsonRetryInstruction` out of `prompt.constants.json`), and Python can't read a TS-hosted string — so the move needs a real mechanism: e.g. core keeps the text in a small JSON file the optimizer can read via `node_modules/wrap-core`, or the bridge gains a print-constants mode. Implementer's pick; a silently dead mirror (key left behind in wrap's constants) is not acceptable. Wrap's *scratchpad* retry is domain logic and stays in wrap — a second send with a transient echo pair (see decision 5 on re-adding transients, and the `echo`-returns-`null` semantics for keeping the rejected response out of replay).

9. **Core defines no env-var contract of its own. Test-provider selection is consumer policy; playback is core mechanics.** Core never *names* an env var (no `LLM_TEST_RESPONSE`, no implicit key lookup) — but resolving the explicit `$ENV_VAR` indirection a consumer wrote into its own config is core mechanics and fine. The test provider is a first-class provider kind taking its canned responses as plain data (playback semantics under the surface sketch). Consumers keep their own env conventions (`WRAP_TEST_RESPONSE(S)`; sweep names its own) and build the config themselves. Reason: a core-read generic env var would silently feed canned responses to every app in that environment; subprocess e2e still works because the consumer owns the env contract. One knowing exception: the ai-SDKs themselves fall back to `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` when no key is passed — upstream provider behavior, not a core-named env var, and keyless-but-env-keyed user configs work through it today. Let it stand; eager validation must not start requiring an explicit key for API kinds.

10. **The provider registry moves whole, wizard metadata included** (key URLs, placeholders, recommended-model regexes, icons, probe commands). It's provider knowledge, not wrap voice; "add a provider = edit one file" survives; sweep will ingest config the same way when that lifts to core later.

11. **`zod` becomes a wrap-core peer dependency** (plus dev for core's own tests). Schemas cross the package boundary; two zod copies risk `z.toJSONSchema` over a foreign instance. This updates the handbook's settled-decisions list, which currently has zod as a direct dep — fix `vault/README.md` in the same promotion.

12. **Hardcoded provider config this version.** Config ingestion (and `parseModelOverride`) lifts to core in a future promotion. Wrap's `resolve-provider.ts` stays in wrap for now — its output shape already matches what core consumes.

13. **No streaming.** Not needed by either consumer at the moment.

## Surface sketch (illustrative — refine freely, preserve the semantics)

The module lands at `src/llm/`, exported as `wrap-core/llm` per the handbook's subpath rule.

```ts
const llm = createLlm({ name, model?, apiKey?, baseURL? });   // or { name: "test", responses }
const chat = llm.startConversation({ system, echo? });

chat.add(message, { meta?, transient? });             // message carries its role
const result = await chat.send(schema, { signal? });  // typed by the schema
chat.log;                                  // one annotated, serializable entry list
llm.label;                                 // "anthropic / claude-…" for verbose/UI

// What an entry holds (shape is latitude; the facets are not):
type Entry = {
  message: LlmMessage | null;  // null = not replayable (failed/aborted/echo-rejected sends)
  meta?: TMeta;                // consumer payload — generic, per the handbook
  transient?: boolean;
  consumed?: boolean;
  attempts?: Attempt[];        // per physical call: request, scrubbed wires, duration, error
  parsed?: unknown;            // validated result on successful sends
};
```

The sketch omits the registry exports — they move shape-intact (decision 10) and are part of `wrap-core/llm`'s surface. Names are latitude too: `log` collides with wrap's JSONL "Log" glossary term (`entries` is fine), and `echo` reads like a boolean at the call site — a clearer name is welcome.

Semantics worth preserving regardless of final shape:

- **Assembly order** = add order; a send assembles every non-consumed entry's message into the request.
- **`add` accepts user and assistant roles.** Consumer-added assistant turns are load-bearing: few-shot pairs, wrap's probe expansion (assistant command + user output), continuation re-adds, the scratchpad echo pair. (System/tool roles stay out — see non-goals.)
- **`meta`** is an opaque consumer payload (wrap: turn kind, exit codes, bare un-framed text) riding alongside the message core sends. It's what makes the log self-sufficient for the consumer's own durable log and for resume. Flow its type through a generic (e.g. `startConversation<TMeta>`) so consumer reads don't cast. Send-produced entries may carry `meta` too if wrap's turn-record rebuild wants it — that annotates the entry, it isn't a message slot, so decision 4 holds; positional correlation is the alternative.
- **`echo`** is a creation-time domain predicate, roughly `(parsed, rawText) => string | null`: what the model sees echoed back as the assistant turn (default: raw text). Only the consumer knows this — wrap strips fields to save tokens and prevent scratchpad misuse. Returning `null` records the entry (attempts, parsed) with **no replayable message** — wrap's scratchpad flow needs this: a schema-valid but domain-rejected response must never enter replay (today it lives only in attempt forensics); the consumer `add`s the round's settled echo explicitly. Exact mechanism is implementer latitude; the requirement is *a domain-rejected response is expressible as non-replayable*. The internal parse-retry echo is raw text verbatim and does not run through this predicate.
- **Failed and aborted sends** leave a log entry with attempts and no replayable message — forensics preserved, replay clean; otherwise the next follow-up on the same conversation would replay a stale assistant turn. The abort case is new capability, not parity: today wrap merely *discards late results* after the await (orphan-turn prevention in `runner.ts`; nothing cancels the call, and `spawnAndRead` has no kill path). `send` takes a signal; aborting seals the entry immediately and the transport's eventual result is discarded internally — wrap's Esc→compose→resubmit flow means a new send can start while an abandoned call is still settling, and core must tolerate that. (A second `send` while one is in flight *without* an abort throws — overlap exists only as abort-then-resubmit.) A replaying consumer skips two things — consumed transients and null-message entries; exposing one queryable predicate (e.g. `replayable`) is sanctioned so replayers have one rule.
- **Errors** are core-typed (parse errors carry the raw text — replaces wrap's sniffing of the ai-SDK's `NoObjectGeneratedError`), with bare plain-language messages; consumers apply their own category prefixes (wrap's `Config error:` / `LLM error (label):`, sweep's `sweep:` invariant) — voice is content, so it stays consumer-side. Eager validation at `createLlm` (registry rules, `$ENV_VAR` key resolution, model required unless the kind is CLI-backed, i.e. claude-code).
- **API keys are scrubbed by core** before wires land in the log. Trace-verbosity gating (wrap's `logTraces`) stays consumer policy at serialization time.
- **Test playback semantics**: a response list (strings or JSON objects; objects are stringified) plays in order and throws on exhaustion; a single response repeats indefinitely (wrap e2e reuses one response across the memory-init send and the query sends — and, newly, across both attempts inside one send); an `ERROR:`-prefixed response throws as a provider error. The list advances per physical call (an in-send retry consumes the next entry), matching today. Two pinned contracts shift *consciously*: today an invalid `WRAP_TEST_RESPONSE` surfaces as one provider-kind attempt, because the test provider does its own parsing and the ladder doesn't classify its errors (`logging.test.ts` pins this) — under core's classification it becomes two attempts ending in a parse-kind error. And wrap's echo-the-last-user-message fallback dies: it existed only for the schemaless path decision 2 abolishes (an echoed user message essentially never satisfies a schema), so no-responses-configured becomes a config error at `createLlm`; delete or replace its pin (`tests/llm.test.ts`).

## Orientation — where things live today

Pointers, not instructions. The implementer should run the import-graph closure (per handbook) and judge.

- `wrap/src/llm/` — types, registry, the adapter factories (one ai-sdk factory dispatching the anthropic/openai/openrouter/openai-compat kinds, the claude-code subprocess, the test provider), spawn helper, `$ENV` key resolution, OpenAI strict-schema walker. The registry's `validate` callbacks are typed against wrap's config `ProviderEntry` — they retype against core's config shape on the way in. The capability also bleeds outside this dir:
- `wrap/src/core/round.ts` — the retry ladder (json-retry steps are the part that promotes).
- `wrap/src/core/transcript.ts` — semantic-turn → message projection (dissolves into add-time framing on the wrap side).
- `wrap/src/llm/build-prompt.ts`, `context.ts`, `format-context.ts` — wrap's prompt scaffold and context formatting. Content, not mechanics: stays in wrap, feeding its add-time framing.
- `wrap/src/core/parse-response.ts` — `StructuredOutputError` + fence-stripping.
- `wrap/src/logging/entry.ts` — wire-capture shapes and key scrubbing.
- `wrap/eval/bridge.ts` — the **third call site**, easy to miss: the Python optimizer's TS bridge imports the ai-SDK error type, `initProvider`, and `buildPromptInput`. Its execute mode calls once with *no* retry; its assemble mode builds the assembled request without sending. It is type-checked and tested by `bun run check`, so the promotion cannot skip it.
- `wrap/vault/llm.md` — current design rationale, including provider-taxonomy reasoning (openai-compat vs openai split, openrouter's first-party SDK, claude-code message flattening) that should survive the move.

Heavy deps (`ai`, `@ai-sdk/*`) fall under the handbook's lazy-load rule. Wrap should end up dropping all five LLM SDK deps from its package.json.

## Expected consumer impact (consequences, not a checklist)

**Wrap.**

- Session owns one conversation per invocation; turns are framed into `add`s as they happen instead of batch-projected per round; per-call directives become ordered transient adds; round logic shrinks to sends + domain retries.
- Logging derives its assistant turn records from the conversation record instead of subscribing to notifications — but the conversation is not wrap's *only* record: `final` turns never enter it (they're projected only on continuation), and the session reads its turns array mid-flight, so wrap keeps its own turns array alongside. Wrap's "empty response" attempt-error is a post-parse domain annotation — it lands in wrap's own serialized records, not core's sealed attempts. The on-disk JSONL schema can stay stable, which concretely requires two things: merging the scratchpad flow's two send entries (plus the explicit settled-echo add) back into today's *one* assistant turn with up to four attempts, and skipping sealed aborted entries (today an aborted round leaves no turn at all).
- The scratchpad round end to end: (1) transient adds (live context, last-round instruction) → (2) send #1 — schema-valid but domain-rejected; `echo` returns `null`, nothing replayable lands → (3) re-add the transients plus the raw rejected JSON as a transient assistant/user echo pair → (4) send #2 → (5) if the response now carries a scratchpad, its echo lands via the predicate; if it's still null (accepted anyway, per today's no-retry-storm rule) or send #2 parse-fails (wrap keeps response #1 for execution), wrap explicitly `add`s the settled echo. Rejection flows through the predicate, acceptance through an explicit add — the asymmetry is intended.
- Continuation (`-c`) re-adds from its own log with the new invocation's framing.
- Memory init becomes a one-send conversation with a facts schema. Known e2e collision: the first-run tests feed one `WRAP_TEST_RESPONSE` to both the init send and the query send (`tests/index.test.ts`, `tests/verbose-e2e.test.ts`); they move to `WRAP_TEST_RESPONSES` with a facts-shaped first entry.
- Registry imports rewire to core: wizard screens, `config/ensure.ts`, `subcommands/completion.ts`, `wizard/write-config.ts`, `resolve-provider.ts`.
- The eval bridge rewires in the same promotion: execute mode = a send with the retry opt-out; assemble mode needs the assembled request without an LLM call — drive a test-provider conversation and read the request off the log, or expose a small read-only assembly accessor (a recorded mechanics sliver, à la `preloadDialogRuntime`); implementer's call once the code is open. The bridge's stdout taxonomy (`ok` / `invalid_json` / `invalid_schema` / `provider_error`) is a second cross-language contract with `optimize.py` — keep emitting it.
- Blast radius is real: ~20 wrap test files import the reshaped seams, and round/transcript/runner/session/logging are interlocked through `AssistantTurn` and the notify bus — they flip together in one commit. Temporary old/new coexistence in wrap is sanctioned: old `src/llm/` survives until a final deletion commit, and the SDK deps leave only then. Don't build throwaway shims to force smaller slices.
- When touching `prompt.constants.json`, read wrap's `.claude/skills/editing-prompts.md` first; the `jsonRetryInstruction` mirror mechanism is decision 8's.

**Sweep.** Hardcoded `ProviderConfig`, a conversation at the analysis seam, one structured send to prove the capability end-to-end (sweep adds `zod` per the peer-dep listing rule). The production install path must not regress: a hardcoded config whose key is `$ENV_VAR` makes eager validation throw mid-install for anyone without that var — the gate is the presence of sweep's own test-provider env contract, checked *before* `createLlm` is ever called — so step 5 stays effectively no-op for real users this promotion, and the capability is proven through sweep's existing in-process harness (`tests/main.test.ts`). The full analysis UX (follow-up dialog, persist/resume) is sweep feature work beyond this promotion. If even minimal wiring balloons, stop and surface scope.

Handbook rules apply: TDD (failing tests first, against the intended pure interface), both consumers wired in the same promotion, every commit leaves all three repos passing `bun run check`.

**Sequencing beyond `bun run check`.** Consumer lockfiles pin `wrap-core` to a GitHub sha (`github:…#main`); the Bun workspace is local-dev plumbing only. So checks stay green throughout while anything installing from lockfiles breaks silently until core is pushed and consumers re-pin: wrap's `optimize` Docker image (`bun install --frozen-lockfile`; mounts `src/` but not `node_modules`) and each consumer's standalone CI. Order at the end: core merges/pushes first; then each consumer refreshes its lockfile's `github:` resolution standalone — note the manifests pin `"wrap-core": "0.0.1"` while the lock holds the `github:…` resolution, so a naive `bun update` may no-op; verify the lock's sha actually moved — then consumer branches merge; rebuild the optimize image after the re-pin (a temporary wrap-core source mount into the container is fine for local iteration). No in-repo check covers this — run the optimizer once after the flip to verify.

## Docs deliverables

- `vault/wrap-core-api/llm.md` — consumer usage doc. Must state: persisting entries durably persists (scrubbed) wire bodies — trace gating is the consumer's job at serialization time; sweep's resume story hits this first.
- `vault/llm.md` — internals note for the non-obvious choices (conversation-is-the-record, always-structured, test-selection-as-policy), plus the provider-taxonomy rationale carried over from wrap's `vault/llm.md` (openai vs openai-compat split, openrouter first-party SDK, claude-code flattening).
- Wrap's `vault/llm.md` becomes a stub pointing into core for moved concerns; wrap-side notes stay (scaffold content; the projection note gets rewritten for add-time framing).

## Non-goals

Streaming; config-ingestion lift; mid-call observability callbacks; retroactive entry mutation; system/tool roles in messages; retry-instruction *text* override (the per-send retry opt-out is in scope — decision 8); new providers (the google TODO stays a TODO).
