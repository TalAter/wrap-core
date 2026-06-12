import { describe, expect, test } from "bun:test";
// Conversation state is a private sibling behind the public `createLlm`
// surface — core tests import it directly.
import {
  type Attempt,
  createConversationState,
  type Entry,
  replayable,
} from "../src/llm/conversation.ts";
import { assistant, user } from "./helpers.ts";

const attempt = (over?: Partial<Attempt>): Attempt => ({
  request: { system: "sys", messages: [] },
  durationMs: 1,
  ...over,
});

describe("createConversationState", () => {
  test("starts empty — no constructor seeding; resume is re-adding through add", () => {
    const conv = createConversationState();
    expect(conv.entries).toHaveLength(0);
  });

  test("add appends in order and accepts user and assistant roles", () => {
    // Consumer-added assistant turns are load-bearing: few-shot pairs,
    // probe expansion, continuation re-adds.
    const conv = createConversationState();
    conv.add(user("question"));
    conv.add(assistant("canned answer"));
    conv.add(user("follow-up"));
    expect(conv.entries.map((e) => e.message)).toEqual([
      { role: "user", content: "question" },
      { role: "assistant", content: "canned answer" },
      { role: "user", content: "follow-up" },
    ]);
  });

  test("meta rides the entry and round-trips with the consumer's type", () => {
    type Meta = { kind: string; exitCode?: number };
    const conv = createConversationState<Meta>();
    conv.add(user("ls"), { meta: { kind: "probe", exitCode: 0 } });
    // Typed read with no cast — TMeta flows factory → add → entries.
    const meta: Meta | undefined = conv.entries[0]?.meta;
    expect(meta).toEqual({ kind: "probe", exitCode: 0 });
  });
});

describe("assembly (internal seam for send)", () => {
  test("beginSend assembles every entry's message in add order", () => {
    const conv = createConversationState();
    conv.add(user("example input"));
    conv.add(assistant("example output"));
    conv.add(user("real input"));
    expect(conv.beginSend()).toEqual([
      { role: "user", content: "example input" },
      { role: "assistant", content: "example output" },
      { role: "user", content: "real input" },
    ]);
  });

  test("transients are sent with at most one send, then retained as consumed", () => {
    // Consumption happens at beginSend, so at-most-one-send holds whether
    // the send later resolves or throws — by construction of
    // consume-at-begin.
    const conv = createConversationState();
    conv.add(user("persistent"));
    conv.add(user("live context"), { transient: true });
    // First send includes the pending transient exactly once.
    expect(conv.beginSend().map((m) => m.content)).toEqual(["persistent", "live context"]);
    // Later sends never resurrect it.
    expect(conv.beginSend().map((m) => m.content)).toEqual(["persistent"]);
    // Retained in entries — message intact, marked consumed — so a replaying
    // consumer can see (and skip) it.
    expect(conv.entries[1]).toEqual({
      message: { role: "user", content: "live context" },
      transient: true,
      consumed: true,
    });
  });

  test("re-adding a consumed transient's message creates a fresh twin that sends once more", () => {
    // Settled decision 5: re-add semantics. Consumption is per-entry —
    // keyed by nothing else — so re-adding the same message object via
    // add({transient: true}) yields a fresh, sendable twin.
    const conv = createConversationState();
    const instruction = user("last-round instruction");
    conv.add(user("persistent"));
    conv.add(instruction, { transient: true });
    expect(conv.beginSend().map((m) => m.content)).toEqual([
      "persistent",
      "last-round instruction",
    ]);

    // Re-add the SAME message object as a new transient entry.
    conv.add(instruction, { transient: true });
    // Assembled exactly once — the fresh twin, not the consumed original.
    // The non-transient entry stays assembled across both sends.
    expect(conv.beginSend().map((m) => m.content)).toEqual([
      "persistent",
      "last-round instruction",
    ]);

    // Entries hold both twins: first consumed, second now consumed too.
    expect(conv.entries).toEqual([
      { message: { role: "user", content: "persistent" } },
      { message: instruction, transient: true, consumed: true },
      { message: instruction, transient: true, consumed: true },
    ]);
  });

  test("record appends send outcomes; null-message entries are excluded from assembly", () => {
    type Meta = { kind: string };
    const conv = createConversationState<Meta>();
    conv.add(user("q"));
    conv.beginSend();
    // A failed/aborted send: forensics retained, nothing replayable — the
    // next send must not replay a stale assistant turn.
    conv.record({
      message: null,
      attempts: [attempt({ error: { kind: "provider", message: "aborted" } })],
    });
    // A successful send: its echo joins subsequent assemblies.
    conv.record({
      message: assistant('{"answer":"hi"}'),
      parsed: { answer: "hi" },
      attempts: [attempt({ durationMs: 12 })],
      meta: { kind: "answer" },
    });
    expect(conv.entries).toHaveLength(3);
    expect(conv.entries[2]?.meta).toEqual({ kind: "answer" });
    expect(conv.beginSend().map((m) => m.content)).toEqual(["q", '{"answer":"hi"}']);
  });
});

describe("replayable", () => {
  test("one rule across all entry states", () => {
    type Meta = { kind: string };
    const conv = createConversationState<Meta>();
    conv.add(user("query")); // plain entry → replayable
    conv.add(user("temp listing"), { transient: true }); // pending transient → replayable
    conv.add(user("instruction"), { transient: true });
    const pendingTransient = conv.entries[1];
    expect(pendingTransient && replayable(pendingTransient)).toBe(true);

    conv.beginSend(); // consumes both transients
    // Echo-rejected send: parsed result retained, message withheld from replay.
    conv.record({ message: null, parsed: { answer: "rejected" }, attempts: [attempt()] });
    // Successful send: echo replays.
    conv.record({ message: assistant("echo"), parsed: { answer: "ok" }, attempts: [attempt()] });

    expect(conv.entries.map((e) => replayable(e))).toEqual([
      true, // plain message
      false, // consumed transient
      false, // consumed transient
      false, // null message — failed/aborted/echo-rejected send
      true, // send echo
    ]);
  });
});

describe("entries are the serializable record", () => {
  test("entries survive a JSON round-trip and replayable works on revived data", () => {
    type Meta = { kind: string };
    const conv = createConversationState<Meta>();
    conv.add(user("q"), { meta: { kind: "query" } });
    conv.add(user("tmp"), { transient: true });
    conv.beginSend();
    conv.record({
      message: assistant("a"),
      parsed: { answer: "a" },
      attempts: [attempt({ durationMs: 12 })],
    });
    conv.record({
      message: null,
      attempts: [attempt({ error: { kind: "provider", message: "boom" } })],
    });

    const revived: Entry<Meta>[] = JSON.parse(JSON.stringify(conv.entries));
    expect(revived).toEqual([...conv.entries]);
    // Replay (consumer re-adding from its durable log) runs over revived
    // entries with no live conversation in hand — the predicate is a free
    // function for exactly that reason.
    expect(revived.filter((e) => replayable(e)).map((e) => e.message?.content)).toEqual(["q", "a"]);
  });
});
