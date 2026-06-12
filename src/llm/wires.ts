// Wire-level forensics for a single physical model call. Private sibling of
// the LLM module; shapes ride inside `Attempt` records, which consumers
// persist — everything here must stay JSON-serializable.
// See vault/impl-specs/llm.md, settled decision 3.

/**
 * What went over the wire, keyed by the transport the provider uses.
 * `http` for ai-SDK providers, `subprocess` for CLI-backed providers
 * (claude-code), `test` for the canned-playback provider.
 */
export type WireRequest =
  | { kind: "http"; body: unknown }
  | { kind: "subprocess"; argv: string[]; stdin: string }
  | { kind: "test" };

export type WireResponse =
  | { kind: "http"; body: unknown; usage?: unknown; finishReason?: string }
  | { kind: "subprocess"; stdout: string; stderr?: string; exitCode: number }
  | { kind: "test" };

/**
 * The optional wire captures of one physical call, as a pair. Anything that
 * carries both sides — provider replies, provider errors, attempts — speaks
 * this shape.
 */
export type WirePair = {
  requestWire?: WireRequest;
  responseWire?: WireResponse;
};

/**
 * Scrub both sides of a wire capture in one pass (see `scrubSecrets`).
 * Absent sides stay absent — the result carries no noise keys.
 */
export function scrubWires(pair: WirePair, secrets?: readonly string[]): WirePair {
  const out: WirePair = {};
  if (pair.requestWire) out.requestWire = scrubSecrets(pair.requestWire, secrets);
  if (pair.responseWire) out.responseWire = scrubSecrets(pair.responseWire, secrets);
  return out;
}

/**
 * Replace every occurrence of each secret inside any string field of `body`
 * with a redacted suffix form (`...last4`). Core applies this to wires
 * before they land in attempts — persisted entries must never carry API
 * keys (spec: "API keys are scrubbed by core").
 *
 * Secrets shorter than 8 chars are skipped: substring matching on short
 * values would redact common noise.
 */
export function scrubSecrets<T>(body: T, secrets: readonly string[] | undefined): T {
  if (body == null || !secrets || secrets.length === 0) return body;
  const usable = secrets.filter((s) => s.length >= 8);
  if (usable.length === 0) return body;

  const scrubString = (value: string): string => {
    let out = value;
    for (const secret of usable) {
      if (out.includes(secret)) out = out.split(secret).join(`...${secret.slice(-4)}`);
    }
    return out;
  };
  const walk = (node: unknown): unknown => {
    if (typeof node === "string") return scrubString(node);
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) out[k] = walk(v);
      return out;
    }
    return node;
  };
  return walk(body) as T;
}
