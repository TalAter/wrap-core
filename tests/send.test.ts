import { describe, expect, test } from "bun:test";
import { z } from "zod";
// Everything here is a private sibling until the public `createLlm` surface
// lands (Unit 4) — core tests import the seams directly.
import { LlmAbortError, LlmParseError, LlmProviderError } from "../src/llm/errors.ts";
import promptConstants from "../src/llm/prompt-constants.json";
import type { ProviderAdapter, ProviderReply, ProviderRequest } from "../src/llm/provider.ts";
import { type Conversation, createConversation } from "../src/llm/send.ts";
import { createTestProvider } from "../src/llm/test-provider.ts";
import { assistant, user } from "./helpers.ts";

const answerSchema = z.object({ answer: z.string() });

/**
 * A provider whose calls settle only when the test says so — the test
 * provider settles immediately, which makes abort/overlap unobservable.
 * Still the internal seam, not a network: each call parks a deferred.
 */
type DeferredCall = {
  request: ProviderRequest;
  resolve: (reply: ProviderReply) => void;
  reject: (error: unknown) => void;
};

function deferredProvider(): { provider: ProviderAdapter; calls: DeferredCall[] } {
  const calls: DeferredCall[] = [];
  return {
    calls,
    provider: {
      call(request) {
        return new Promise<ProviderReply>((resolve, reject) => {
          calls.push({ request, resolve, reject });
        });
      },
    },
  };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("send — happy path", () => {
  test("returns the schema-parsed value and records echo + parsed + one attempt", async () => {
    const conv = createConversation(createTestProvider('{"answer":"hi"}'), { system: "sys" });
    conv.add(user("question"));

    const result = await conv.send(answerSchema);
    // Typed by the schema — no cast needed for the property read.
    expect(result.answer).toBe("hi");

    expect(conv.entries).toHaveLength(2);
    const entry = conv.entries[1];
    // Default echo: the raw text verbatim becomes the assistant message.
    expect(entry?.message).toEqual({ role: "assistant", content: '{"answer":"hi"}' });
    expect(entry?.parsed).toEqual({ answer: "hi" });
    expect(entry?.attempts).toHaveLength(1);
    const attempt = entry?.attempts?.[0];
    expect(attempt?.rawText).toBe('{"answer":"hi"}');
    expect(attempt?.error).toBeUndefined();
    expect(typeof attempt?.durationMs).toBe("number");
    expect(attempt?.requestWire).toEqual({ kind: "test" });
    expect(attempt?.responseWire).toEqual({ kind: "test" });
  });

  test("fence-stripping: a single fenced block parses; echo and rawText stay verbatim", async () => {
    const fenced = '```json\n{"answer":"hi"}\n```';
    const conv = createConversation(createTestProvider(fenced), { system: "sys" });
    conv.add(user("q"));

    const result = await conv.send(answerSchema);
    expect(result).toEqual({ answer: "hi" });
    // Verbatim raw text — fence-stripping feeds only the JSON parser.
    expect(conv.entries[1]?.message?.content).toBe(fenced);
    expect(conv.entries[1]?.attempts?.[0]?.rawText).toBe(fenced);
  });

  test("assembles add-order, keeps system out of messages, passes the live schema", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "the system prompt" });
    conv.add(user("example input"));
    conv.add(assistant("example output"));
    conv.add(user("real input"));

    const pending = conv.send(answerSchema);
    await settle();
    const request = d.calls[0]?.request;
    expect(request?.system).toBe("the system prompt");
    expect(request?.messages).toEqual([
      { role: "user", content: "example input" },
      { role: "assistant", content: "example output" },
      { role: "user", content: "real input" },
    ]);
    // The live zod schema crosses the seam so real adapters can shape the
    // wire request; parse classification still happens in send.
    expect(request?.schema).toBe(answerSchema);

    d.calls[0]?.resolve({ text: '{"answer":"ok"}' });
    await pending;
    // The attempt's request is the serializable twin: a schema *descriptor*.
    const attempt = conv.entries[3]?.attempts?.[0];
    expect(attempt?.request.system).toBe("the system prompt");
    expect(attempt?.request.messages).toHaveLength(3);
    expect(attempt?.request.schema).toMatchObject({ type: "object" });
  });
});

describe("echo predicate", () => {
  test("custom predicate's string becomes the entry's assistant message", async () => {
    const conv = createConversation(createTestProvider('{"answer":"hi"}'), {
      system: "sys",
      formatEcho: (parsed, rawText) => {
        expect(rawText).toBe('{"answer":"hi"}');
        return `settled: ${(parsed as { answer: string }).answer}`;
      },
    });
    conv.add(user("q"));
    await conv.send(answerSchema);
    expect(conv.entries[1]?.message).toEqual({ role: "assistant", content: "settled: hi" });
  });

  test("null keeps the domain-rejected response out of replay but retains forensics", async () => {
    const conv = createConversation(
      createTestProvider(['{"answer":"rejected"}', '{"answer":"ok"}']),
      {
        system: "sys",
        formatEcho: (parsed) =>
          (parsed as { answer: string }).answer === "rejected" ? null : "fine",
      },
    );
    conv.add(user("q"));

    const first = await conv.send(answerSchema);
    expect(first).toEqual({ answer: "rejected" });
    expect(conv.entries[1]?.message).toBeNull();
    expect(conv.entries[1]?.parsed).toEqual({ answer: "rejected" });
    expect(conv.entries[1]?.attempts).toHaveLength(1);

    // The rejected response never enters a later send's assembly.
    conv.add(user("follow-up"));
    await conv.send(answerSchema);
    const secondRequest = conv.entries[3]?.attempts?.[0]?.request;
    expect(secondRequest?.messages.map((m) => m.content)).toEqual(["q", "follow-up"]);
  });

  test("a throwing predicate rejects the send, seals the entry, and frees the conversation", async () => {
    const boom = new Error("formatEcho exploded");
    let echoCalls = 0;
    const conv = createConversation(createTestProvider(['{"answer":"hi"}', '{"answer":"again"}']), {
      system: "sys",
      formatEcho: () => {
        echoCalls += 1;
        if (echoCalls === 1) throw boom;
        return "settled";
      },
    });
    conv.add(user("q"));

    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBe(boom);

    // Sealed like any failure: forensics intact, nothing replayable.
    const entry = conv.entries[1];
    expect(entry?.message).toBeNull();
    expect(entry?.parsed).toBeUndefined();
    expect(entry?.attempts).toHaveLength(1);
    expect(entry?.attempts?.[0]?.rawText).toBe('{"answer":"hi"}');

    // inFlight cleared at seal — a follow-up send works.
    await expect(conv.send(answerSchema)).resolves.toEqual({ answer: "again" });
    expect(conv.entries[2]?.message).toEqual({ role: "assistant", content: "settled" });
  });
});

describe("parse retry", () => {
  test("corrective instruction is wrap's jsonRetryInstruction verbatim", () => {
    // Cross-language contract (decision 8): wrap's Python optimizer reads
    // this exact string out of the JSON asset via node_modules/wrap-core.
    expect(promptConstants.jsonRetryInstruction).toBe(
      "Respond ONLY with valid JSON matching the schema. No markdown fences, no comments, no text outside the JSON object.",
    );
  });

  test("parse failure retries exactly once: echo pair in request only, transients consumed once", async () => {
    const conv = createConversation(
      createTestProvider(["not json", '{"answer":"ok"}', '{"answer":"third"}']),
      { system: "sys" },
    );
    conv.add(user("q"));
    conv.add(user("live context"), { transient: true });

    const result = await conv.send(answerSchema);
    expect(result).toEqual({ answer: "ok" });

    // One send = one entry, even across two physical calls.
    expect(conv.entries).toHaveLength(3);
    const entry = conv.entries[2];
    expect(entry?.message?.content).toBe('{"answer":"ok"}');
    expect(entry?.attempts).toHaveLength(2);
    expect(entry?.attempts?.[0]?.error).toEqual({
      kind: "parse",
      message: expect.stringContaining("JSON") as unknown as string,
    });
    expect(entry?.attempts?.[0]?.rawText).toBe("not json");
    expect(entry?.attempts?.[1]?.error).toBeUndefined();

    // Attempt 2's assembly = attempt 1's + the failed text echoed back +
    // the corrective instruction. The transient appears exactly once —
    // beginSend ran once; the retry extended that assembly locally.
    expect(entry?.attempts?.[1]?.request.messages).toEqual([
      { role: "user", content: "q" },
      { role: "user", content: "live context" },
      { role: "assistant", content: "not json" },
      { role: "user", content: promptConstants.jsonRetryInstruction },
    ]);

    // The retry echo pair exists only in attempt forensics — never in entries.
    const allContents = conv.entries.map((e) => e.message?.content);
    expect(allContents).not.toContain(promptConstants.jsonRetryInstruction);

    // Playback advanced two physical calls; the transient is consumed.
    conv.add(user("next"));
    const next = await conv.send(answerSchema);
    expect(next).toEqual({ answer: "third" });
    expect(conv.entries[4]?.attempts?.[0]?.request.messages.map((m) => m.content)).toEqual([
      "q",
      '{"answer":"ok"}',
      "next",
    ]);
  });

  test("schema-invalid JSON (parses, fails validation) also classifies as parse and retries", async () => {
    const conv = createConversation(createTestProvider(['{"wrong":1}', '{"answer":"ok"}']), {
      system: "sys",
    });
    conv.add(user("q"));
    const result = await conv.send(answerSchema);
    expect(result).toEqual({ answer: "ok" });
    expect(conv.entries[1]?.attempts?.[0]?.error?.kind).toBe("parse");
    expect(conv.entries[1]?.attempts?.[0]?.error?.message).toContain("schema");
  });

  test("second parse failure throws a typed error carrying raw text; entry sealed with message null", async () => {
    const conv = createConversation(createTestProvider(["bad one", "bad two"]), { system: "sys" });
    conv.add(user("q"));

    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmParseError);
    expect((error as LlmParseError).rawText).toBe("bad two");

    const entry = conv.entries[1];
    expect(entry?.message).toBeNull();
    expect(entry?.parsed).toBeUndefined();
    expect(entry?.attempts).toHaveLength(2);
    expect(entry?.attempts?.map((a) => a.error?.kind)).toEqual(["parse", "parse"]);
  });

  test("{ retry: false } makes a single attempt and surfaces the malformed output", async () => {
    // Wrap's eval bridge calls once with no retry — malformed output is its
    // optimization signal, not a failure to hide.
    const conv = createConversation(createTestProvider(["bad", '{"answer":"ok"}']), {
      system: "sys",
    });
    conv.add(user("q"));

    const error = await conv.send(answerSchema, { retry: false }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmParseError);
    expect((error as LlmParseError).rawText).toBe("bad");
    expect(conv.entries[1]?.attempts).toHaveLength(1);

    // Exactly one physical call happened — the next send gets response #2.
    conv.add(user("again"));
    await expect(conv.send(answerSchema)).resolves.toEqual({ answer: "ok" });
  });
});

describe("test provider playback", () => {
  test("a single response repeats indefinitely across sends", async () => {
    const conv = createConversation(createTestProvider('{"answer":"same"}'), { system: "sys" });
    conv.add(user("q"));
    expect(await conv.send(answerSchema)).toEqual({ answer: "same" });
    expect(await conv.send(answerSchema)).toEqual({ answer: "same" });
    expect(await conv.send(answerSchema)).toEqual({ answer: "same" });
  });

  test("a single response repeats across both attempts inside one send", async () => {
    const conv = createConversation(createTestProvider("never json"), { system: "sys" });
    conv.add(user("q"));
    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmParseError);
    expect(conv.entries[1]?.attempts?.map((a) => a.rawText)).toEqual(["never json", "never json"]);
  });

  test("object responses are stringified", async () => {
    const conv = createConversation(createTestProvider([{ answer: "obj" }]), { system: "sys" });
    conv.add(user("q"));
    expect(await conv.send(answerSchema)).toEqual({ answer: "obj" });
    expect(conv.entries[1]?.attempts?.[0]?.rawText).toBe('{"answer":"obj"}');
  });

  test("an ERROR:-prefixed response throws a provider error and seals the entry", async () => {
    const conv = createConversation(createTestProvider("ERROR: boom"), { system: "sys" });
    conv.add(user("q"));
    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toBe("boom");

    const entry = conv.entries[1];
    expect(entry?.message).toBeNull();
    expect(entry?.attempts).toHaveLength(1);
    expect(entry?.attempts?.[0]?.error).toEqual({ kind: "provider", message: "boom" });
    expect(entry?.attempts?.[0]?.requestWire).toEqual({ kind: "test" });
  });

  test("an exhausted list throws a provider error on the next physical call", async () => {
    const conv = createConversation(createTestProvider(['{"answer":"only"}']), { system: "sys" });
    conv.add(user("q"));
    await conv.send(answerSchema);
    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toContain("1 provided");
  });

  test("mid-send exhaustion: parse failure on attempt 1, provider exhaustion on the retry", async () => {
    const conv = createConversation(createTestProvider(["not json"]), { system: "sys" });
    conv.add(user("q"));

    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmProviderError);

    const entry = conv.entries[1];
    expect(entry?.message).toBeNull();
    expect(entry?.attempts).toHaveLength(2);
    expect(entry?.attempts?.[0]?.error?.kind).toBe("parse");
    expect(entry?.attempts?.[1]?.error?.kind).toBe("provider");
    expect(entry?.attempts?.[1]?.error?.message).toContain("1 provided");
  });
});

describe("abort", () => {
  test("abort seals the entry immediately, discards the late result, and frees the conversation", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "sys" });
    conv.add(user("q"));

    const controller = new AbortController();
    const aborted = conv.send(answerSchema, { signal: controller.signal });
    await settle();
    controller.abort();

    const error = await aborted.catch((e) => e);
    expect(error).toBeInstanceOf(LlmAbortError);

    // Sealed at abort time: attempts so far (the call never settled), no
    // replayable message.
    expect(conv.entries).toHaveLength(2);
    expect(conv.entries[1]?.message).toBeNull();
    expect(conv.entries[1]?.attempts).toEqual([]);

    // In-flight cleared at abort-seal time — a new send starts while the
    // abandoned transport is still pending.
    const fresh = conv.send(answerSchema);
    await settle();

    // The abandoned call settles late: its result must be discarded — no
    // second record, no corruption of the in-flight send.
    d.calls[0]?.resolve({ text: '{"answer":"stale"}' });
    await settle();
    expect(conv.entries).toHaveLength(2);

    d.calls[1]?.resolve({ text: '{"answer":"fresh"}' });
    await expect(fresh).resolves.toEqual({ answer: "fresh" });
    expect(conv.entries).toHaveLength(3);
    expect(conv.entries[2]?.parsed).toEqual({ answer: "fresh" });
  });

  test("abort-then-resubmit works in the same tick — no await between abort and the next send", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "sys" });
    conv.add(user("q"));

    const controller = new AbortController();
    const first = conv.send(answerSchema, { signal: controller.signal });
    // The abort listener seals synchronously, so the resubmit finds
    // inFlight already cleared — without awaiting the first rejection.
    controller.abort();
    const second = conv.send(answerSchema);

    await expect(first).rejects.toBeInstanceOf(LlmAbortError);
    d.calls[1]?.resolve({ text: '{"answer":"fresh"}' });
    await expect(second).resolves.toEqual({ answer: "fresh" });

    // Exactly two send entries: the sealed abort, then the success.
    expect(conv.entries).toHaveLength(3);
    expect(conv.entries[1]?.message).toBeNull();
    expect(conv.entries[1]?.attempts).toEqual([]);
    expect(conv.entries[2]?.parsed).toEqual({ answer: "fresh" });
  });

  test("abort while the retry attempt is in flight seals with only attempt 1's parse failure", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "sys" });
    conv.add(user("q"));

    const controller = new AbortController();
    const pending = conv.send(answerSchema, { signal: controller.signal });
    await settle();
    d.calls[0]?.resolve({ text: "not json" });
    await settle();
    expect(d.calls).toHaveLength(2); // the corrective retry is in flight
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LlmAbortError);
    const entry = conv.entries[1];
    expect(entry?.message).toBeNull();
    // Attempt 2 never settled — exactly attempt 1's forensics survive.
    expect(entry?.attempts).toHaveLength(1);
    expect(entry?.attempts?.[0]?.error?.kind).toBe("parse");
  });

  test("a late rejection from an abandoned transport is absorbed — no unhandled rejection, no second record", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "sys" });
    conv.add(user("q"));

    const controller = new AbortController();
    const pending = conv.send(answerSchema, { signal: controller.signal });
    await settle();
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(LlmAbortError);

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    try {
      d.calls[0]?.reject(new LlmProviderError("socket hang up"));
      await settle();
      await settle();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(conv.entries).toHaveLength(2); // the sealed abort entry — nothing recorded twice
  });

  test("an already-aborted signal rejects before anything starts — no entry, no consumption", async () => {
    const conv = createConversation(createTestProvider('{"answer":"hi"}'), { system: "sys" });
    conv.add(user("q"));
    conv.add(user("ctx"), { transient: true });

    const controller = new AbortController();
    controller.abort();
    const error = await conv.send(answerSchema, { signal: controller.signal }).catch((e) => e);
    expect(error).toBeInstanceOf(LlmAbortError);
    expect(conv.entries).toHaveLength(2);
    expect(conv.entries[1]?.consumed).toBeUndefined();
  });
});

describe("overlap", () => {
  test("a second send while one is in flight without abort throws", async () => {
    const d = deferredProvider();
    const conv = createConversation(d.provider, { system: "sys" });
    conv.add(user("q"));

    const first = conv.send(answerSchema);
    await settle();
    const error = await conv.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("in flight");

    // The rejected overlap left no trace; the first send completes normally.
    d.calls[0]?.resolve({ text: '{"answer":"ok"}' });
    await expect(first).resolves.toEqual({ answer: "ok" });
    expect(conv.entries).toHaveLength(2);
    expect(d.calls).toHaveLength(1);
  });
});

describe("meta", () => {
  test("send meta annotates the entry on success and on failure", async () => {
    type Meta = { kind: string };
    const conv = createConversation<Meta>(createTestProvider(['{"answer":"hi"}', "ERROR: down"]), {
      system: "sys",
    });
    conv.add(user("q"));
    await conv.send(answerSchema, { meta: { kind: "analysis" } });
    expect(conv.entries[1]?.meta).toEqual({ kind: "analysis" });

    await conv.send(answerSchema, { meta: { kind: "doomed" }, retry: false }).catch(() => {});
    expect(conv.entries[2]?.meta).toEqual({ kind: "doomed" });
  });
});

describe("forensics", () => {
  test("core scrubs provider secrets from wires before they land in attempts", async () => {
    const secret = "sk-test-superduper-9876";
    const provider: ProviderAdapter = {
      secrets: [secret],
      call: async () => ({
        text: '{"answer":"ok"}',
        requestWire: { kind: "http", body: { headers: { authorization: `Bearer ${secret}` } } },
        responseWire: { kind: "http", body: { echoed: secret } },
      }),
    };
    const conv = createConversation(provider, { system: "sys" });
    conv.add(user("q"));
    await conv.send(answerSchema);

    const attempt = conv.entries[1]?.attempts?.[0];
    expect(attempt?.requestWire).toEqual({
      kind: "http",
      body: { headers: { authorization: "Bearer ...9876" } },
    });
    expect(attempt?.responseWire).toEqual({ kind: "http", body: { echoed: "...9876" } });
  });

  test("send-produced entries survive a JSON round-trip", async () => {
    const conv = createConversation(createTestProvider(["bad", '{"answer":"ok"}']), {
      system: "sys",
    });
    conv.add(user("q"));
    await conv.send(answerSchema);
    expect(JSON.parse(JSON.stringify(conv.entries))).toEqual([...conv.entries]);
  });
});

// Compile-time pin for decision 2's object-shape note: top-level schemas must
// be object-shaped (OpenAI strict mode rejects bare strings) — prose answers
// use { answer: z.string() }-shaped schemas. Never invoked.
const _rejectsBareStringSchemas = (conv: Conversation) =>
  // @ts-expect-error — a bare z.string() top-level schema must not typecheck
  conv.send(z.string());
