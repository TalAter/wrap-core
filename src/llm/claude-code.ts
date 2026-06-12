// claude-code adapter — drives the `claude` CLI as a subprocess. Private
// sibling: consumers reach it only through `createLlm`.
//
// Taxonomy rationale (carried from wrap's vault): the claude CLI has no
// multi-turn input format, so the conversation flattens into one
// "User:"/"Assistant:" plaintext prompt. It runs in a tmpdir with session
// persistence off — never leaks the consumer process's cwd into the model's
// context and writes no session state to disk.

import { tmpdir } from "node:os";
import { z } from "zod";
import type { LlmMessage } from "./conversation.ts";
import { LlmProviderError } from "./errors.ts";
import type { ProviderAdapter, ResolvedProviderConfig } from "./provider.ts";
import { type SpawnAndRead, spawnAndRead } from "./spawn.ts";
import type { WirePair } from "./wires.ts";

/** Flatten conversation messages into a single string for the -p flag. */
export function flattenMessages(messages: readonly LlmMessage[]): string {
  return messages
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n\n");
}

export function buildArgv(system: string, model: string | undefined, schemaJson: string): string[] {
  return [
    "claude",
    "--tools",
    "",
    "--system-prompt",
    system,
    ...(model ? ["--model", model] : []),
    "--no-session-persistence",
    // "--bare" would skip config/MCP discovery (10x faster startup) but also
    // skips credential loading, so `claude` exits with "Not logged in".
    // Enable if this is fixed in Claude Code.
    "--json-schema",
    schemaJson,
    "-p",
  ];
}

/**
 * `spawn` is an injection seam for tests; production callers take the
 * default. The subprocess gets the send's abort signal, so an abort kills
 * the CLI instead of letting it run to completion in the background.
 */
export function createClaudeCodeAdapter(
  config: ResolvedProviderConfig,
  spawn: SpawnAndRead = spawnAndRead,
): ProviderAdapter {
  return {
    // The CLI authenticates itself and never receives a configured key, but
    // declare one anyway so `send` scrubs it defensively (parity with the
    // ai-sdk adapter and wrap's defensive scrub).
    secrets: config.apiKey ? [config.apiKey] : undefined,

    async call(request, opts) {
      const argv = buildArgv(
        request.system,
        config.model,
        JSON.stringify(z.toJSONSchema(request.schema)),
      );
      const stdin = flattenMessages(request.messages);
      const { stdout, stderr, exitCode } = await spawn(argv, stdin, {
        cwd: tmpdir(),
        signal: opts?.signal,
      });

      const wires: WirePair = {
        requestWire: { kind: "subprocess", argv, stdin },
        responseWire: {
          kind: "subprocess",
          stdout,
          exitCode,
          ...(stderr ? { stderr } : {}),
        },
      };
      if (exitCode !== 0) {
        throw new LlmProviderError(
          stderr.trim() || `${argv[0]} exited with code ${exitCode}.`,
          wires,
        );
      }
      return { text: stdout.trim(), ...wires };
    },
  };
}
