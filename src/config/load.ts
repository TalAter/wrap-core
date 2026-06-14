// Config-file ingestion lifted to core from wrap. Read a JSONC file under
// an app's home, parse it, and optionally fold a JSON env override over it.
// Core stays app-agnostic: the consumer names the filename and the env var;
// core never hardcodes either. Messages are bare plain language — no category
// prefix — so consumers prepend their own voice and remediation.

import { type ParseError, parse } from "jsonc-parser";
import type { AppFs } from "../fs/index.ts";
import type { ProvidersConfig } from "./provider.ts";

/**
 * A config file or env override could not be parsed. Mirrors `LlmConfigError`'s
 * shape: a thin `Error` subclass carrying a bare plain-language message. The
 * surfacing consumer prepends its own category prefix (wrap's "Config error:",
 * sweep's "sweep:") and remediation — voice is content.
 */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Load an app's JSONC config and fold in an optional JSON env override.
 *
 * The file is read under `fs.root`; an absent file is the empty config `{}`,
 * not an error. JSONC comments and trailing commas are accepted. When
 * `opts.envOverrideVar` is set, the named variable (from `opts.env`, default
 * `process.env`) — if its trimmed value is non-empty — is `JSON.parse`d and
 * SHALLOW-merged over the file config: env wins at the top level and nested
 * objects are replaced wholesale, never deep-merged.
 *
 * The result is returned typed as `T`; core does not validate the shape beyond
 * parsing. `T` defaults to `ProvidersConfig` (the provider-bearing subset);
 * apps pass their own intersected config type.
 *
 * Throws `ConfigError` with a bare message naming the offending source (the
 * filename for file parse failures, the env var for override failures).
 */
export function loadJsoncConfig<T = ProvidersConfig>(
  fs: AppFs,
  filename: string,
  opts: { envOverrideVar?: string; env?: Record<string, string | undefined> } = {},
): T {
  const fileConfig = loadFileConfig(fs, filename);
  const envConfig = loadEnvConfig(opts.envOverrideVar, opts.env ?? process.env);

  if (envConfig === undefined) return fileConfig as T;

  // Shallow, matching wrap's historical `loadConfig` — see this function's doc.
  return { ...fileConfig, ...envConfig } as T;
}

function loadFileConfig(fs: AppFs, filename: string): Record<string, unknown> {
  const raw = fs.read(filename);
  if (raw === null) return {};

  const errors: ParseError[] = [];
  const parsed = parse(raw, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    throw new ConfigError(`${filename} contains invalid JSON.`);
  }
  return parsed ?? {};
}

function loadEnvConfig(
  envOverrideVar: string | undefined,
  env: Record<string, string | undefined>,
): Record<string, unknown> | undefined {
  if (!envOverrideVar) return undefined;
  const raw = env[envOverrideVar]?.trim();
  if (!raw) return undefined;

  try {
    return JSON.parse(raw);
  } catch {
    throw new ConfigError(`${envOverrideVar} contains invalid JSON.`);
  }
}
