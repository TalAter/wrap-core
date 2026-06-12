import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LlmMessage } from "../src/llm/conversation.ts";

/**
 * Create an isolated temp dir for use as an app-home in tests.
 * Cleanup is the caller's responsibility (typically `afterEach(() =>
 * rmSync(home, { recursive: true, force: true }))`).
 */
export function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "wrap-core-test-"));
}

/** `LlmMessage` literal shorthands for conversation/send tests. */
export const user = (content: string): LlmMessage => ({ role: "user", content });
export const assistant = (content: string): LlmMessage => ({ role: "assistant", content });
