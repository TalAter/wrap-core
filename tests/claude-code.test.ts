import { describe, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { z } from "zod";
// Private siblings — adapter internals are tested directly; consumers only
// ever reach them through createLlm.
import { buildArgv, createClaudeCodeAdapter, flattenMessages } from "../src/llm/claude-code.ts";
import { LlmProviderError } from "../src/llm/errors.ts";
import type { ProviderRequest } from "../src/llm/provider.ts";
import { type SpawnAndRead, type SpawnOptions, spawnAndRead } from "../src/llm/spawn.ts";
import { answerSchema, assistant, user } from "./helpers.ts";

const request = (messages: ProviderRequest["messages"]): ProviderRequest => ({
  system: "the system prompt",
  messages,
  schema: answerSchema,
});

describe("flattenMessages", () => {
  test('flattens roles into "User:"/"Assistant:" plaintext separated by blank lines', () => {
    expect(flattenMessages([user("hello"), assistant("hi there"), user("again")])).toBe(
      "User: hello\n\nAssistant: hi there\n\nUser: again",
    );
  });

  test("a single message carries no separators", () => {
    expect(flattenMessages([user("only")])).toBe("User: only");
  });
});

describe("buildArgv", () => {
  const schemaJson = JSON.stringify(z.toJSONSchema(answerSchema));

  test("builds the full claude invocation with model and schema", () => {
    expect(buildArgv("sys", "haiku", schemaJson)).toEqual([
      "claude",
      "--tools",
      "",
      "--system-prompt",
      "sys",
      "--model",
      "haiku",
      "--no-session-persistence",
      "--json-schema",
      schemaJson,
      "-p",
    ]);
  });

  test("omits --model when the entry has none (the CLI picks its own default)", () => {
    const argv = buildArgv("sys", undefined, schemaJson);
    expect(argv).not.toContain("--model");
    expect(argv.at(-1)).toBe("-p");
  });
});

describe("createClaudeCodeAdapter", () => {
  type SpawnCall = { cmd: string[]; stdin: string; opts?: SpawnOptions };

  function fakeSpawn(result: { stdout?: string; stderr?: string; exitCode?: number }): {
    spawn: SpawnAndRead;
    calls: SpawnCall[];
  } {
    const calls: SpawnCall[] = [];
    return {
      calls,
      spawn: async (cmd, stdin, opts) => {
        calls.push({ cmd, stdin, opts });
        return {
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          exitCode: result.exitCode ?? 0,
        };
      },
    };
  }

  test("flattens the conversation into stdin, runs in a tmpdir, returns trimmed stdout", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: '{"answer":"ok"}\n' });
    const adapter = createClaudeCodeAdapter({ name: "claude-code", model: "haiku" }, spawn);

    const reply = await adapter.call(request([user("q1"), assistant("a1"), user("q2")]));
    expect(reply.text).toBe('{"answer":"ok"}');

    expect(calls).toHaveLength(1);
    expect(calls[0]?.stdin).toBe("User: q1\n\nAssistant: a1\n\nUser: q2");
    expect(calls[0]?.opts?.cwd).toBe(tmpdir());
    expect(calls[0]?.cmd).toEqual(
      buildArgv("the system prompt", "haiku", JSON.stringify(z.toJSONSchema(answerSchema))),
    );
  });

  test("captures subprocess wires: argv + stdin / stdout + exitCode, stderr only when present", async () => {
    const { spawn } = fakeSpawn({ stdout: "out", stderr: "" });
    const adapter = createClaudeCodeAdapter({ name: "claude-code" }, spawn);

    const reply = await adapter.call(request([user("q")]));
    expect(reply.requestWire).toEqual({
      kind: "subprocess",
      argv: buildArgv("the system prompt", undefined, JSON.stringify(z.toJSONSchema(answerSchema))),
      stdin: "User: q",
    });
    expect(reply.responseWire).toEqual({ kind: "subprocess", stdout: "out", exitCode: 0 });
  });

  test("nonzero exit throws LlmProviderError carrying stderr and the wires", async () => {
    const { spawn } = fakeSpawn({ stdout: "", stderr: "Not logged in\n", exitCode: 1 });
    const adapter = createClaudeCodeAdapter({ name: "claude-code" }, spawn);

    const error = await adapter.call(request([user("q")])).catch((e) => e);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect((error as LlmProviderError).message).toBe("Not logged in");
    expect((error as LlmProviderError).requestWire).toMatchObject({ kind: "subprocess" });
    expect((error as LlmProviderError).responseWire).toEqual({
      kind: "subprocess",
      stdout: "",
      stderr: "Not logged in\n",
      exitCode: 1,
    });
  });

  test("nonzero exit with silent stderr still produces a message", async () => {
    const { spawn } = fakeSpawn({ exitCode: 7 });
    const adapter = createClaudeCodeAdapter({ name: "claude-code" }, spawn);
    const error = await adapter.call(request([user("q")])).catch((e) => e);
    expect((error as Error).message).toBe("claude exited with code 7.");
  });

  test("forwards the abort signal to the subprocess seam", async () => {
    const { spawn, calls } = fakeSpawn({ stdout: "{}" });
    const adapter = createClaudeCodeAdapter({ name: "claude-code" }, spawn);
    const controller = new AbortController();
    await adapter.call(request([user("q")]), { signal: controller.signal });
    expect(calls[0]?.opts?.signal).toBe(controller.signal);
  });
});

describe("spawnAndRead", () => {
  test("pipes stdin and reads stdout with a zero exit", async () => {
    const result = await spawnAndRead(["cat"], "hello from stdin");
    expect(result).toEqual({ stdout: "hello from stdin", stderr: "", exitCode: 0 });
  });

  test("returns (not throws) a nonzero exit and stderr", async () => {
    const result = await spawnAndRead(["sh", "-c", "echo oops >&2; exit 3"], "");
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toBe("oops\n");
  });

  test("an abort kills the subprocess instead of waiting it out", async () => {
    const controller = new AbortController();
    const started = performance.now();
    const pending = spawnAndRead(["sleep", "5"], "", { signal: controller.signal });
    setTimeout(() => controller.abort(), 25);
    const result = await pending;
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0);
  });

  test("an already-aborted signal kills immediately", async () => {
    const controller = new AbortController();
    controller.abort();
    const started = performance.now();
    const result = await spawnAndRead(["sleep", "5"], "", { signal: controller.signal });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(result.exitCode).not.toBe(0);
  });
});
