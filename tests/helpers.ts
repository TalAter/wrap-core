import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create an isolated temp dir for use as an app-home in tests.
 * Cleanup is the caller's responsibility (typically `afterEach(() =>
 * rmSync(home, { recursive: true, force: true }))`).
 */
export function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "wrap-core-test-"));
}
