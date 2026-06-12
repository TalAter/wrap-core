import { afterEach, describe, expect, test } from "bun:test";
// Deliberately the public surface: everything here imports through
// src/llm/index.ts, the only path consumers are allowed to reach.
import { createLlm, LlmConfigError, replayable } from "../src/llm/index.ts";
import { answerSchema } from "./helpers.ts";

/** Run `fn`, assert it threw an LlmConfigError, hand back its message. */
function configErrorMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(LlmConfigError);
    return (error as Error).message;
  }
  throw new Error("expected createLlm to throw");
}

describe("createLlm — eager validation", () => {
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  function setEnv(key: string, value: string) {
    savedEnv[key] = process.env[key];
    process.env[key] = value;
  }

  function deleteEnv(key: string) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }

  test("unknown provider missing fields → bare registry message, no prefix", () => {
    expect(configErrorMessage(() => createLlm({ name: "custom", model: "m" }))).toBe(
      'provider "custom" requires baseURL, apiKey, and model.',
    );
  });

  test("known compat provider without baseURL → bare registry message", () => {
    expect(configErrorMessage(() => createLlm({ name: "ollama", model: "llama3" }))).toBe(
      'provider "ollama" requires baseURL.',
    );
  });

  test("$ENV_VAR apiKey naming an unset variable throws at createLlm, not at send", () => {
    deleteEnv("WRAP_CORE_NO_SUCH_KEY_12345");
    expect(
      configErrorMessage(() =>
        createLlm({
          name: "anthropic",
          model: "claude-sonnet-4-6",
          apiKey: "$WRAP_CORE_NO_SUCH_KEY_12345",
        }),
      ),
    ).toBe("environment variable WRAP_CORE_NO_SUCH_KEY_12345 is not set.");
  });

  test("$ENV_VAR apiKey resolves from the environment", () => {
    setEnv("WRAP_CORE_TEST_KEY", "sk-from-env");
    const llm = createLlm({
      name: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "$WRAP_CORE_TEST_KEY",
    });
    expect(llm.label).toBe("anthropic / claude-sonnet-4-6");
  });

  test("model is required for API kinds", () => {
    expect(configErrorMessage(() => createLlm({ name: "anthropic", apiKey: "sk-x" }))).toBe(
      'provider "anthropic" requires a model.',
    );
  });

  test("model is optional for CLI-backed kinds (claude-code)", () => {
    const llm = createLlm({ name: "claude-code" });
    expect(llm.label).toBe("claude-code / (default)");
  });

  test("keyless API kinds stay legal — the SDK's own env-key fallback stands", () => {
    // Decision 9's knowing exception: no explicit apiKey must NOT become a
    // config error; the ai-SDKs fall back to ANTHROPIC_API_KEY etc.
    const llm = createLlm({ name: "anthropic", model: "claude-sonnet-4-6" });
    expect(llm.label).toBe("anthropic / claude-sonnet-4-6");
  });

  test("test kind with no responses configured is a config error", () => {
    expect(configErrorMessage(() => createLlm({ name: "test" }))).toBe(
      'test provider has no responses configured (the name "test" selects canned playback).',
    );
  });

  test("test kind with an empty responses list is a config error", () => {
    expect(configErrorMessage(() => createLlm({ name: "test", responses: [] }))).toBe(
      'test provider has no responses configured (the name "test" selects canned playback).',
    );
  });
});

describe("createLlm — label", () => {
  test('formats "name / model"', () => {
    const llm = createLlm({ name: "openai", model: "gpt-5", apiKey: "sk-x" });
    expect(llm.label).toBe("openai / gpt-5");
  });

  test("test kind without a model shows (default)", () => {
    const llm = createLlm({ name: "test", responses: "x" });
    expect(llm.label).toBe("test / (default)");
  });
});

describe("createLlm — startConversation", () => {
  test("returns a working conversation over the test kind", async () => {
    const llm = createLlm({ name: "test", responses: { answer: "hi" } });
    const chat = llm.startConversation({ system: "sys" });
    chat.add({ role: "user", content: "q" });

    const result = await chat.send(answerSchema);
    expect(result).toEqual({ answer: "hi" });

    expect(chat.entries).toHaveLength(2);
    const sent = chat.entries[1];
    expect(sent?.message).toEqual({ role: "assistant", content: '{"answer":"hi"}' });
    expect(sent?.parsed).toEqual({ answer: "hi" });
    if (!sent) throw new Error("entry missing");
    expect(replayable(sent)).toBe(true);
  });

  test("flows formatEcho and TMeta through to the conversation", async () => {
    type Meta = { kind: string };
    const llm = createLlm({ name: "test", responses: ['{"answer":"raw"}'] });
    const chat = llm.startConversation<Meta>({
      system: "sys",
      formatEcho: (parsed) => `settled: ${(parsed as { answer: string }).answer}`,
    });
    chat.add({ role: "user", content: "q" }, { meta: { kind: "ask" } });
    await chat.send(answerSchema, { meta: { kind: "analysis" } });

    expect(chat.entries[0]?.meta).toEqual({ kind: "ask" });
    expect(chat.entries[1]?.meta).toEqual({ kind: "analysis" });
    expect(chat.entries[1]?.message?.content).toBe("settled: raw");
  });
});
