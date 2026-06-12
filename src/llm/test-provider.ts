// Canned-playback provider — a first-class provider kind, not a test-only
// shim. Takes its responses as plain data: core never reads env vars
// (vault/impl-specs/llm.md, decision 9 — test-provider *selection* is
// consumer policy; playback is core mechanics).

import { LlmProviderError } from "./errors.ts";
import type { ProviderAdapter } from "./provider.ts";

export type TestResponse = string | Record<string, unknown>;

/**
 * A list plays in order — one entry per physical call (an in-send parse
 * retry consumes the next entry) — and exhausts. A single bare response
 * repeats indefinitely across all calls and attempts. Objects are
 * stringified; an `ERROR:`-prefixed string throws as a provider error.
 */
export type TestResponses = TestResponse | readonly TestResponse[];

export function createTestProvider(responses: TestResponses): ProviderAdapter {
  let callIndex = 0;

  const next = (): string => {
    if (!Array.isArray(responses)) {
      return typeof responses === "string" ? responses : JSON.stringify(responses);
    }
    const entry: TestResponse | undefined = responses[callIndex];
    callIndex += 1;
    if (entry === undefined) {
      throw new LlmProviderError(
        `No test response left for call ${callIndex} (${responses.length} provided).`,
        { requestWire: { kind: "test" } },
      );
    }
    return typeof entry === "string" ? entry : JSON.stringify(entry);
  };

  return {
    async call() {
      const raw = next();
      if (raw.startsWith("ERROR:")) {
        throw new LlmProviderError(raw.slice("ERROR:".length).trimStart(), {
          requestWire: { kind: "test" },
          responseWire: { kind: "test" },
        });
      }
      return { text: raw, requestWire: { kind: "test" }, responseWire: { kind: "test" } };
    },
  };
}
