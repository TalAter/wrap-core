// The send engine — composes a provider with conversation state into the
// stateful Conversation. Private sibling: the public surface (`createLlm` →
// `startConversation`) lands in a later promotion unit on top of this
// factory. See vault/impl-specs/llm.md, settled decisions 2, 3, 8.

import { type ZodType, z } from "zod";
import {
  type AddOptions,
  type Attempt,
  type AttemptRequest,
  createConversationState,
  type Entry,
  type LlmMessage,
  type SendOutcome,
} from "./conversation.ts";
import { LlmAbortError, LlmParseError, LlmProviderError } from "./errors.ts";
// Recorded exception to the handbook's prompt-text-is-content rule
// (decision 8, same standing as preloadDialogRuntime): the corrective
// retry instruction is core-owned default content — the retry is invisible
// mechanics, so its text ships with the mechanics. It lives in a plain JSON
// asset (not a TS constant) because wrap's Python optimizer reads it via
// node_modules/wrap-core/src/llm/prompt-constants.json for its PROMPT_HASH
// manifest — a cross-language contract a TS-hosted string cannot honor.
import promptConstants from "./prompt-constants.json";
import type { ProviderAdapter, ProviderReply } from "./provider.ts";
import { scrubSecrets, scrubWires } from "./wires.ts";

/**
 * Creation-time domain predicate: what the model sees echoed back as the
 * assistant turn on a schema-valid send. Only the consumer can answer this
 * (wrap strips fields to save tokens and prevent scratchpad misuse).
 * Returning `null` records the entry (attempts, parsed) with no replayable
 * message — a domain-rejected response must never enter replay. Default:
 * the raw text verbatim. The internal parse-retry echo does NOT run through
 * this predicate.
 */
export type EchoPredicate = (parsed: unknown, rawText: string) => string | null;

export type ConversationOptions = {
  /** Conversation-level system prompt — configuration, not an entry. */
  system: string;
  /** See `EchoPredicate`. Named as a verb — it's a formatter, not a flag. */
  formatEcho?: EchoPredicate;
};

export type SendOptions<TMeta = unknown> = {
  /**
   * Aborting seals the entry synchronously (attempts so far, no replayable
   * message) and rejects with `LlmAbortError`; the transport's eventual
   * result is discarded internally. Abort-then-resubmit is the only
   * sanctioned overlap — and because the seal is synchronous, the resubmit
   * may follow `abort()` in the same tick, without awaiting the rejection.
   */
  signal?: AbortSignal;
  /**
   * Default true: exactly one parse retry (echo the failed raw text + the
   * corrective instruction), then a typed error. `false` makes a single
   * attempt — wrap's eval bridge wants malformed output as its signal.
   */
  retry?: boolean;
  /** Annotates the send-produced entry — not a message slot (decision 4). */
  meta?: TMeta;
};

export interface Conversation<TMeta = unknown> {
  add(message: LlmMessage, opts?: AddOptions<TMeta>): void;
  readonly entries: readonly Entry<TMeta>[];
  /**
   * Always structured (decision 2): a zod schema is required, and the
   * top-level schema must be object-shaped — OpenAI strict mode rejects
   * bare strings, so prose answers use `{ answer: z.string() }` shapes.
   * The `ZodType<object>` constraint catches bare primitives at the type
   * level; top-level arrays and root unions slip through (TS counts
   * `string[]` as `object`) and surface as provider errors out of the
   * provider layer's strict-schema transform.
   */
  send<TSchema extends ZodType<object>>(
    schema: TSchema,
    opts?: SendOptions<TMeta>,
  ): Promise<z.output<TSchema>>;
}

// Pre-trimmed input, so the closing fence is always at end-of-string.
const FENCE_RE = /^```\w*\s*\n([\s\S]*)\n```$/;

/** Strip markdown fences only if the entire response is a single fenced block. */
function stripFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(FENCE_RE);
  if (!match) return trimmed;
  const inner = match[1] as string;
  // More backticks inside means this isn't one clean block — leave it alone.
  if (inner.includes("```")) return trimmed;
  return inner.trim();
}

type ParseOutcome<TValue> = { ok: true; value: TValue } | { ok: false; message: string };

/** Fence-strip → JSON.parse → schema.parse. Classification, not transport. */
function parseReply<TSchema extends ZodType<object>>(
  schema: TSchema,
  rawText: string,
): ParseOutcome<z.output<TSchema>> {
  let json: unknown;
  try {
    json = JSON.parse(stripFences(rawText));
  } catch {
    return { ok: false, message: "Model response was not valid JSON." };
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    return { ok: false, message: "Model response did not match the expected schema." };
  }
  return { ok: true, value: result.data };
}

/**
 * Serializable twin of the live schema for attempt forensics. Conversion
 * failures (schemas with unrepresentable parts) just drop the descriptor —
 * forensics must never break a send.
 */
function describeSchema(schema: ZodType<object>): unknown {
  try {
    return z.toJSONSchema(schema);
  } catch {
    return undefined;
  }
}

/**
 * Resolve/reject with `promise`, but reject with `LlmAbortError` the moment
 * `signal` fires — without waiting for the transport to settle. The
 * underlying promise keeps its handler attached, so a late settle is
 * silently absorbed (no unhandled rejection) and never reaches `send`.
 */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  // Already aborted: a listener added now would never run (the event has
  // fired) — without this fast-path, a signal-ignoring adapter would hang.
  if (signal.aborted) {
    promise.catch(() => {}); // absorb the abandoned transport's late settle
    return Promise.reject(new LlmAbortError());
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new LlmAbortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * Internal factory over `ConversationState` + a provider. The returned
 * `entries`/`add` are the state's own; `send` is the only code path that
 * touches the `beginSend`/`record` seams.
 */
export function createConversation<TMeta = unknown>(
  provider: ProviderAdapter,
  options: ConversationOptions,
): Conversation<TMeta> {
  const state = createConversationState<TMeta>();
  const formatEcho: EchoPredicate = options.formatEcho ?? ((_parsed, rawText) => rawText);
  let inFlight = false;

  /**
   * One physical call: build the serializable request, call the provider
   * (racing the signal), and append a settled `Attempt`. Attempts are
   * pushed only once settled — an aborted call leaves no half-written
   * attempt for the seal to copy, and its late settle can't mutate a
   * sealed entry.
   */
  async function physicalCall(
    messages: LlmMessage[],
    schema: ZodType<object>,
    schemaDescriptor: unknown,
    signal: AbortSignal | undefined,
    attempts: Attempt[],
  ): Promise<{ reply: ProviderReply; attempt: Attempt }> {
    const request: AttemptRequest = { system: options.system, messages };
    if (schemaDescriptor !== undefined) request.schema = schemaDescriptor;
    const startedAt = performance.now();
    const settled = (extra: Partial<Attempt>): Attempt => {
      const attempt: Attempt = {
        request,
        durationMs: Math.round(performance.now() - startedAt),
        ...extra,
      };
      attempts.push(attempt);
      return attempt;
    };

    try {
      const reply = await raceAbort(
        provider.call({ system: options.system, messages, schema }, { signal }),
        signal,
      );
      return {
        reply,
        attempt: settled({ rawText: reply.text, ...scrubWires(reply, provider.secrets) }),
      };
    } catch (error) {
      // Abort: the call never settled — no attempt to record; the entry
      // seal happens in send's failure path.
      if (error instanceof LlmAbortError) throw error;
      const providerError =
        error instanceof LlmProviderError
          ? error
          : new LlmProviderError(error instanceof Error ? error.message : String(error));
      settled({
        // Scrub the message too: an HTTP 401 body can quote the key into the
        // transport's message. The THROWN error keeps its original message —
        // only what persists in attempt forensics is scrubbed.
        error: { kind: "provider", message: scrubSecrets(providerError.message, provider.secrets) },
        ...scrubWires(providerError, provider.secrets),
      });
      throw providerError;
    }
  }

  async function send<TSchema extends ZodType<object>>(
    schema: TSchema,
    opts?: SendOptions<TMeta>,
  ): Promise<z.output<TSchema>> {
    // Overlap check BEFORE anything consumes state: a second send while one
    // is in flight is sanctioned only as abort-then-resubmit.
    if (inFlight) {
      // Plain Error, not a typed Llm* one: a consumer programming-contract
      // violation, never an operational outcome to branch on.
      throw new Error(
        "A send is already in flight on this conversation. Abort it before sending again.",
      );
    }
    // An already-fired signal means the send never starts: no transient
    // consumption, no entry — distinct from a mid-flight abort, which seals.
    if (opts?.signal?.aborted) throw new LlmAbortError();
    inFlight = true;

    const attempts: Attempt[] = [];
    let sealed = false;
    /**
     * Exactly one `record` per `beginSend`, enforced here. Clearing
     * `inFlight` at seal time is what makes abort-then-resubmit legal while
     * the abandoned transport is still settling.
     */
    const seal = (message: LlmMessage | null, parsed?: unknown): void => {
      if (sealed) return;
      sealed = true;
      inFlight = false;
      const outcome: SendOutcome<TMeta> = { message, attempts };
      if (opts?.meta !== undefined) outcome.meta = opts.meta;
      if (parsed !== undefined) outcome.parsed = parsed;
      state.record(outcome);
    };

    // beginSend exactly once per send: it consumes transients as a side
    // effect, so the retry below extends this assembly locally instead of
    // re-assembling.
    const baseMessages = state.beginSend();
    const schemaDescriptor = describeSchema(schema);

    // Seal ON the abort event, not in the rejection handler: the rejection
    // arrives a microtask later, and "aborting seals the entry immediately"
    // is literal — `controller.abort(); conv.send(next)` in one tick must
    // find `inFlight` already cleared. The catch below still runs for the
    // rejection itself; `seal` is idempotent.
    const sealOnAbort = () => seal(null);
    opts?.signal?.addEventListener("abort", sealOnAbort, { once: true });

    const succeed = (parsed: z.output<TSchema>, rawText: string): z.output<TSchema> => {
      const echoed = formatEcho(parsed, rawText);
      seal(echoed === null ? null : { role: "assistant", content: echoed }, parsed);
      return parsed;
    };

    try {
      const first = await physicalCall(
        baseMessages,
        schema,
        schemaDescriptor,
        opts?.signal,
        attempts,
      );
      const firstParse = parseReply(schema, first.reply.text);
      if (firstParse.ok) return succeed(firstParse.value, first.reply.text);
      first.attempt.error = { kind: "parse", message: firstParse.message };
      if (opts?.retry === false) throw new LlmParseError(firstParse.message, first.reply.text);

      // Exactly one parse retry (decision 8): attempt 1's assembly + the
      // failed raw text echoed verbatim + the corrective instruction. The
      // echo pair never enters entries and never runs through the echo
      // predicate — it exists only in attempt 2's request forensics.
      const retryMessages: LlmMessage[] = [
        ...baseMessages,
        { role: "assistant", content: first.reply.text },
        { role: "user", content: promptConstants.jsonRetryInstruction },
      ];
      const second = await physicalCall(
        retryMessages,
        schema,
        schemaDescriptor,
        opts?.signal,
        attempts,
      );
      const secondParse = parseReply(schema, second.reply.text);
      if (secondParse.ok) return succeed(secondParse.value, second.reply.text);
      second.attempt.error = { kind: "parse", message: secondParse.message };
      throw new LlmParseError(secondParse.message, second.reply.text);
    } catch (error) {
      // Single failure seam: parse, provider, and abort errors all seal the
      // entry — forensics retained, nothing replayable — then rethrow typed.
      seal(null);
      throw error;
    } finally {
      opts?.signal?.removeEventListener("abort", sealOnAbort);
    }
  }

  return {
    add: (message, opts) => state.add(message, opts),
    get entries() {
      return state.entries;
    },
    send,
  };
}
