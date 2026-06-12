import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
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

/** The canonical object-shaped send schema used across the LLM tests. */
export const answerSchema = z.object({ answer: z.string() });
