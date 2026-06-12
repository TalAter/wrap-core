// Conversation state — the entry list behind the LLM module's stateful
// Conversation. Private sibling: `send.ts` composes this state with the
// provider seam, and consumers reach it only through `createLlm` →
// `startConversation`. Only `replayable` and the entry/message types are
// re-exported from index.ts.
// See vault/impl-specs/llm.md, settled decisions 1, 3–7.

import type { WireRequest, WireResponse } from "./wires.ts";

/**
 * A single conversation message. System and tool roles are deliberately
 * absent: the system prompt is conversation-level configuration, not an
 * entry, and tool calls are out of scope for this module.
 */
export type LlmMessage = {
  readonly role: "user" | "assistant";
  readonly content: string;
};

/**
 * Categorical error on a failed attempt. `parse` = the reply text could not
 * become a schema-valid value (send's classification); `provider` = the
 * transport/provider failed before a usable reply existed.
 */
export type AttemptError = { kind: "parse" | "provider"; message: string };

/**
 * The assembled request behind one physical call. `schema` is a JSON Schema
 * *descriptor* of the live zod schema (which is not serializable); absent
 * when the schema could not be described.
 */
export type AttemptRequest = {
  system: string;
  messages: readonly LlmMessage[];
  schema?: unknown;
};

/**
 * Per-physical-call record on a send-produced entry, populated by `send`.
 * Must stay JSON-serializable: attempts ride in entries, which consumers
 * persist — and that durably persists (scrubbed) wire bodies; trace gating
 * is consumer policy at serialization time.
 */
export type Attempt = {
  request: AttemptRequest;
  requestWire?: WireRequest;
  responseWire?: WireResponse;
  /** The model's reply text, verbatim — absent when the call never settled. */
  rawText?: string;
  durationMs: number;
  error?: AttemptError;
};

/**
 * One annotated entry in the conversation record.
 *
 * `message: null` means *not replayable*: failed, aborted, and
 * echo-rejected sends keep their forensics (attempts, parsed) in the record
 * without polluting replay — otherwise the next send on a resumed
 * conversation would replay a stale assistant turn.
 *
 * Fields are `readonly`: entries are append-only (settled decision 6) — no
 * retroactive editing or re-flagging. The only state transition is the
 * internal consumed flip when a send assembles a transient.
 */
export type Entry<TMeta = unknown> = {
  readonly message: LlmMessage | null;
  /** Opaque consumer payload riding alongside the message core sends. */
  readonly meta?: TMeta;
  /** Added with `{ transient: true }` — sent with at most one send. */
  readonly transient?: boolean;
  /** Set once a transient has been included in a send's assembly. */
  readonly consumed?: boolean;
  /** Per-physical-call records, populated by send. */
  readonly attempts?: readonly Attempt[];
  /** Validated result on successful sends. */
  readonly parsed?: unknown;
};

/** Internal: same entry, writable — consumption flips `consumed` in place. */
type MutableEntry<TMeta> = { -readonly [K in keyof Entry<TMeta>]: Entry<TMeta>[K] };

export type AddOptions<TMeta = unknown> = {
  /** Consumer payload retained on the entry (never sent to the model). */
  meta?: TMeta;
  /**
   * Sent with at most one send, then never again — consumed whether that
   * send resolves or throws. Retained in entries, marked `consumed`.
   */
  transient?: boolean;
};

/**
 * What a settled send appends to the record: the assistant echo (or `null`
 * when there is nothing replayable — failure, abort, echo rejection), plus
 * forensics. This is `send`'s internal seam, not a second way for consumers
 * to add messages (settled decision 4).
 */
export type SendOutcome<TMeta = unknown> = {
  message: LlmMessage | null;
  meta?: TMeta;
  attempts?: Attempt[];
  parsed?: unknown;
};

/**
 * Conversation entry state. Named `entries`, not `log` — wrap's glossary
 * already uses "Log" for its on-disk JSONL records, and this list is a
 * different thing (the in-memory conversation record).
 *
 * `beginSend` and `record` are internal seams for `send` (next promotion
 * unit); they are never part of the public consumer surface.
 */
export interface ConversationState<TMeta = unknown> {
  /**
   * The only way messages enter a conversation. Accepts user and assistant
   * roles — consumer-added assistant turns carry few-shot pairs, probe
   * expansions, and continuation re-adds.
   */
  add(message: LlmMessage, opts?: AddOptions<TMeta>): void;

  /**
   * The annotated, append-only, JSON-serializable conversation record.
   * Persisting it durably persists everything in it — including attempts.
   */
  readonly entries: readonly Entry<TMeta>[];

  /**
   * Internal seam: snapshot the messages a send carries — every
   * non-consumed entry's non-null message, in add order. Atomically marks
   * the included transients consumed: consumption happens when the send
   * *begins*, so "at most one send" holds by construction even when the
   * send later throws or aborts, and a second assembly can never resurrect
   * them. Callers must run their in-flight/overlap check BEFORE calling
   * `beginSend`, because assembly consumes transients as a side effect.
   */
  beginSend(): LlmMessage[];

  /**
   * Internal seam: append the entry a settled send produced.
   *
   * Caller-owned invariants: at most one `record` per `beginSend`; an
   * aborted send records its sealed entry at abort time and must never
   * record again when the transport settles. `attempts` is copied on
   * record, so a late push into the caller's live attempts accumulator
   * cannot edit the sealed entry — the seal is real.
   */
  record(outcome: SendOutcome<TMeta>): void;
}

/**
 * One rule for replaying consumers: an entry re-enters a fresh conversation
 * (via `add`) iff it carries a non-null message and is not a consumed
 * transient. A free function rather than a method because replay typically
 * runs over a deserialized record, with no live conversation in hand.
 */
export function replayable(entry: Entry<unknown>): boolean {
  return entry.message !== null && !(entry.transient && entry.consumed);
}

/**
 * Create empty conversation state. Takes no seed/history on purpose
 * (settled decision 7): resuming is the consumer mapping its own durable
 * record back into `add`s, applying fresh per-invocation framing as it
 * does so — one way for messages to enter.
 */
export function createConversationState<TMeta = unknown>(): ConversationState<TMeta> {
  const entries: MutableEntry<TMeta>[] = [];

  // Optional facets are assigned only when present so serialized entries
  // carry no noise keys.
  return {
    add(message, opts) {
      const entry: MutableEntry<TMeta> = { message };
      if (opts?.meta !== undefined) entry.meta = opts.meta;
      if (opts?.transient) entry.transient = true;
      entries.push(entry);
    },

    get entries() {
      return entries;
    },

    beginSend() {
      const messages: LlmMessage[] = [];
      for (const entry of entries) {
        if (entry.consumed || entry.message === null) continue;
        messages.push(entry.message);
        if (entry.transient) entry.consumed = true;
      }
      return messages;
    },

    record(outcome) {
      const entry: MutableEntry<TMeta> = { message: outcome.message };
      if (outcome.meta !== undefined) entry.meta = outcome.meta;
      // Shallow copy — rationale in `record`'s interface TSDoc above.
      if (outcome.attempts !== undefined) entry.attempts = [...outcome.attempts];
      if (outcome.parsed !== undefined) entry.parsed = outcome.parsed;
      entries.push(entry);
    },
  };
}
