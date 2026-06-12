import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
// The ai-sdk adapter's call() mapping, pinned end-to-end against a real local
// HTTP endpoint: createLlm with a user-defined openai-compat provider whose
// baseURL points at a per-test Bun.serve.
import { createLlm, LlmAbortError, LlmProviderError } from "../src/llm/index.ts";
import { answerSchema } from "./helpers.ts";

const API_KEY = "sk-local-fake-key-7890";

describe("ai-sdk adapter against a local endpoint", () => {
  let server: ReturnType<typeof Bun.serve> | undefined;
  let savedWarnLogger: unknown;

  beforeAll(() => {
    // The generic openai-compatible SDK warns that it drops the JSON schema
    // for non-strict providers — expected for unknown user-defined endpoints;
    // keep the test output clean.
    savedWarnLogger = (globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS;
    (globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = false;
  });

  afterAll(() => {
    (globalThis as Record<string, unknown>).AI_SDK_LOG_WARNINGS = savedWarnLogger;
  });

  afterEach(() => {
    server?.stop(true);
    server = undefined;
  });

  /** Serve `handler` on an ephemeral port; hand back the /v1 baseURL. */
  function serve(handler: (req: Request) => Response | Promise<Response>): string {
    server = Bun.serve({ port: 0, fetch: handler });
    return `http://127.0.0.1:${server.port}/v1`;
  }

  /** A conversation over an unknown (openai-compat) provider at `baseURL`. */
  function startChat(baseURL: string) {
    const llm = createLlm({ name: "local-fake", model: "fake-model", apiKey: API_KEY, baseURL });
    const chat = llm.startConversation({ system: "sys" });
    chat.add({ role: "user", content: "q" });
    return chat;
  }

  const completionBody = (content: string) => ({
    id: "chatcmpl-1",
    object: "chat.completion",
    created: 0,
    model: "fake-model",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
  });

  test("happy path: adapter returns the message text, send parses it, wires stay body-only", async () => {
    // Captured eagerly — Bun recycles the Request object after the handler.
    const seen: { url: string; auth: string | null }[] = [];
    const baseURL = serve((req) => {
      seen.push({ url: req.url, auth: req.headers.get("authorization") });
      return Response.json(completionBody('{"answer":"hi"}'));
    });
    const chat = startChat(baseURL);

    await expect(chat.send(answerSchema)).resolves.toEqual({ answer: "hi" });

    // The request really went over HTTP with the key in the auth header...
    expect(seen[0]?.url).toBe(`${baseURL}/chat/completions`);
    expect(seen[0]?.auth).toBe(`Bearer ${API_KEY}`);

    const attempt = chat.entries[1]?.attempts?.[0];
    expect(attempt?.rawText).toBe('{"answer":"hi"}');
    // requestWire is absent on this SDK family: openai-compatible reports
    // request.body as a pre-serialized JSON string, and buildWireRequest
    // captures object bodies only.
    expect(attempt?.requestWire).toBeUndefined();
    expect(attempt?.responseWire).toMatchObject({
      kind: "http",
      finishReason: "stop",
      body: { model: "fake-model", choices: [{ message: { content: '{"answer":"hi"}' } }] },
    });
    // ...but the persisted wires are body-only: no headers field anywhere,
    // and the key never appears (it only ever lived in a header).
    const wires = JSON.stringify([attempt?.requestWire ?? null, attempt?.responseWire ?? null]);
    expect(wires).not.toContain("headers");
    expect(wires).not.toContain(API_KEY);
  });

  test("HTTP 401 quoting the key → LlmProviderError; entry wires and message are scrubbed", async () => {
    const baseURL = serve(() =>
      Response.json(
        { error: { message: `Invalid API key: ${API_KEY}`, type: "invalid_request_error" } },
        { status: 401 },
      ),
    );
    const chat = startChat(baseURL);

    const error = await chat.send(answerSchema).catch((e) => e);
    expect(error).toBeInstanceOf(LlmProviderError);

    // Provider errors don't parse-retry: one sealed attempt, nothing replayable.
    const entry = chat.entries[1];
    expect(entry?.message).toBeNull();
    expect(entry?.attempts).toHaveLength(1);
    expect(entry?.attempts?.[0]?.error?.kind).toBe("provider");
    // The error path captures a body-only requestWire (APICallError's
    // requestBodyValues, system/messages stripped).
    expect(entry?.attempts?.[0]?.requestWire).toMatchObject({
      kind: "http",
      body: { model: "fake-model" },
    });
    // End-to-end proof of send's declared-secret scrub: the 401 body and the
    // transport's message quoted the key; the persisted entry redacts it.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain(API_KEY);
    expect(entry?.attempts?.[0]?.error?.message).toContain(`...${API_KEY.slice(-4)}`);
  });

  test("abort mid-request → LlmAbortError; the entry is sealed", async () => {
    let requestArrived: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      requestArrived = resolve;
    });
    const baseURL = serve(() => {
      requestArrived();
      return new Promise<Response>(() => {}); // hold the request open forever
    });
    const chat = startChat(baseURL);

    const controller = new AbortController();
    const pending = chat.send(answerSchema, { signal: controller.signal });
    await arrived; // the HTTP request is in flight at the endpoint
    controller.abort();

    await expect(pending).rejects.toBeInstanceOf(LlmAbortError);
    expect(chat.entries[1]?.message).toBeNull();
    expect(chat.entries[1]?.attempts).toEqual([]);
  });
});
