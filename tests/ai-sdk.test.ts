import { describe, expect, test } from "bun:test";
import { z } from "zod";
// Private siblings — adapter internals are tested directly; consumers only
// ever reach them through createLlm.
import { buildModel, buildWireRequest, toOpenAIStrictSchema } from "../src/llm/ai-sdk.ts";
import { LlmConfigError } from "../src/llm/errors.ts";

// Asserts on the AI SDK's internal `.provider` tag (e.g. `openai.responses`,
// `groq.chat`, `openrouter`) — intentionally brittle so accidental regressions
// (Responses API against compat endpoints, openrouter falling back to the
// generic openai-compat adapter) fail loudly.
describe("buildModel routing", () => {
  async function info(
    config: Parameters<typeof buildModel>[0],
  ): Promise<{ provider: string; modelId: string }> {
    const m = await buildModel(config);
    if (typeof m === "string") throw new Error("expected LanguageModel object");
    return { provider: m.provider, modelId: m.modelId };
  }

  test("anthropic → anthropic.messages", async () => {
    const m = await info({ name: "anthropic", model: "claude-sonnet-4-6", apiKey: "x" });
    expect(m.provider).toBe("anthropic.messages");
    expect(m.modelId).toBe("claude-sonnet-4-6");
  });

  test("openai → openai.responses (keeps Responses API)", async () => {
    const m = await info({ name: "openai", model: "gpt-5", apiKey: "x" });
    expect(m.provider).toBe("openai.responses");
  });

  test("openrouter → first-party @openrouter/ai-sdk-provider (provider tag 'openrouter')", async () => {
    const m = await info({
      name: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      apiKey: "x",
      baseURL: "https://openrouter.ai/api/v1",
    });
    expect(m.provider).toBe("openrouter");
  });

  test("openrouter works without an explicit baseURL (SDK default)", async () => {
    const m = await info({ name: "openrouter", model: "google/gemini-2.5-flash", apiKey: "x" });
    expect(m.provider).toBe("openrouter");
  });

  test("groq → groq.chat", async () => {
    const m = await info({
      name: "groq",
      model: "llama-3.1-70b",
      apiKey: "x",
      baseURL: "https://api.groq.com/openai/v1",
    });
    expect(m.provider).toBe("groq.chat");
  });

  test("ollama → ollama.chat with placeholder key for keyless local endpoints", async () => {
    const m = await info({ name: "ollama", model: "llama3", baseURL: "http://localhost:11434/v1" });
    expect(m.provider).toBe("ollama.chat");
  });

  test("unknown openai-compat provider → name.chat", async () => {
    const m = await info({
      name: "custom",
      model: "some-model",
      apiKey: "x",
      baseURL: "https://api.example.com/v1",
    });
    expect(m.provider).toBe("custom.chat");
  });

  test("rejects when model missing", async () => {
    await expect(buildModel({ name: "openai" })).rejects.toThrow(LlmConfigError);
    await expect(buildModel({ name: "openai" })).rejects.toThrow(/requires a model/);
  });

  test("rejects when openai-compat has no baseURL", async () => {
    await expect(buildModel({ name: "groq", model: "x", apiKey: "k" })).rejects.toThrow(
      /requires baseURL/,
    );
  });

  test("rejects when called with claude-code (CLI provider)", async () => {
    await expect(buildModel({ name: "claude-code", model: "x" })).rejects.toThrow(/CLI provider/);
  });
});

describe("buildWireRequest", () => {
  test("strips system and messages, keeps SDK-added delta", () => {
    const raw = {
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: [{ text: "You are a tool", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: "hi" }],
      tool_choice: { type: "tool", name: "response" },
      tools: [{ name: "response", input_schema: {} }],
    };
    const wire = buildWireRequest(raw);
    expect(wire).toBeDefined();
    if (!wire) throw new Error("wire missing");
    expect(wire.kind).toBe("http");
    if (wire.kind !== "http") throw new Error("kind");
    const body = wire.body as Record<string, unknown>;
    expect(body.model).toBe("claude-sonnet-4-6");
    expect(body.max_tokens).toBe(8192);
    expect(body.tools).toBeDefined();
    expect("system" in body).toBe(false);
    expect("messages" in body).toBe(false);
  });

  test("returns undefined for absent body", () => {
    expect(buildWireRequest(undefined)).toBeUndefined();
    expect(buildWireRequest(null)).toBeUndefined();
  });

  test("returns undefined for non-object body", () => {
    expect(buildWireRequest("some string")).toBeUndefined();
    expect(buildWireRequest(42)).toBeUndefined();
  });
});

describe("toOpenAIStrictSchema", () => {
  // .nullable().optional() — the shape strict mode trips over: the JSON
  // schema carries anyOf [type, null] but no `required` entry.
  const schema = z.object({
    type: z.string(),
    note: z.string().nullable().optional(),
    nested: z
      .object({
        a: z.string(),
        b: z.number().nullable().optional(),
      })
      .nullable()
      .optional(),
    list: z.array(z.object({ x: z.string(), y: z.string().nullable().optional() })),
  });

  test("every property lands in required, recursively", async () => {
    const wrapped = await toOpenAIStrictSchema(schema);
    const raw = wrapped.jsonSchema as Record<string, unknown>;
    expect(raw.required).toEqual(["type", "note", "nested", "list"]);

    const props = raw.properties as Record<string, Record<string, unknown>>;
    // The nullable nested object lives inside an anyOf branch — the walker
    // must descend into anyOf/oneOf/allOf and array items.
    const nestedBranches = props.nested?.anyOf as Record<string, unknown>[];
    const nestedObject = nestedBranches.find((b) => b.type === "object");
    expect(nestedObject?.required).toEqual(["a", "b"]);

    const items = (props.list as { items: Record<string, unknown> }).items;
    expect(items.required).toEqual(["x", "y"]);
  });

  test("nullable optional fields keep their anyOf [type, null] shape", async () => {
    const wrapped = await toOpenAIStrictSchema(schema);
    const raw = wrapped.jsonSchema as Record<string, unknown>;
    const props = raw.properties as Record<string, Record<string, unknown>>;
    expect(props.note?.anyOf).toEqual([{ type: "string" }, { type: "null" }]);
  });

  test("does not mutate the source zod schema's JSON projection", async () => {
    await toOpenAIStrictSchema(schema);
    const fresh = z.toJSONSchema(schema) as Record<string, unknown>;
    expect(fresh.required).toEqual(["type", "list"]);
  });
});
