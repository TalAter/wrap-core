---
name: config
description: Config-file ingestion + real-provider resolution — JSONC load with env override, resolve a providers config into an Llm.
package: wrap-core/config
---

# config

One import surface for turning an app's config file into an `Llm`: read a JSONC file under an `AppFs`, fold an optional JSON env override over it, then resolve the provider it names and build the handle. Exists to de-duplicate the config ingestion wrap and sweep both need. App-agnostic by design — core never names an env var, a filename, or speaks an app's voice. The consumer passes `filename`/`envOverrideVar`; error messages are BARE, and the consumer prepends its own prefix and remediation (wrap's "Config error:", sweep's "sweep:"). This is why the test-provider sentinel and `--model` override parsing stay app-side, not here. Builds on `wrap-core/llm` (the registry it validates against, `createLlm` it ends in) and `wrap-core/fs` (the `AppFs` it reads through).

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `loadJsoncConfig` | `<T = ProvidersConfig>(fs: AppFs, filename: string, opts?: { envOverrideVar?: string; env?: Record<string, string \| undefined> }) => T` | Reads `filename` under `fs.root` (JSONC: comments + trailing commas OK); absent file → `{}`, not an error. When `envOverrideVar` is set and its value (from `opts.env`, default `process.env`) trims non-empty, that value is `JSON.parse`d and SHALLOW-folded over the file: env wins top-level, nested objects replaced wholesale (never deep-merged). No shape validation past parsing — returned as `T`. Throws `ConfigError` (bare message naming the offending source) on malformed file or env JSON. |
| `resolveProvider` | `(config: ProvidersConfig) => ResolvedProvider` | REAL-provider resolution only — no env reads, no test sentinel. Validation order: defaultProvider present → entry found → registry per-entry validator → model present (skipped for `modelOptional` CLI kinds like claude-code). Each failure throws a bare `LlmConfigError`. |
| `llmFromResolved` | `(resolved: ResolvedProvider) => Llm` | Thin pass to `createLlm`; `$ENV_VAR` indirection and literal keys are dereferenced there (a missing var throws `LlmConfigError`, bare). |
| `ProvidersConfig` | `{ providers?: Record<string, ProviderEntry>; defaultProvider?: string }` | The config SUBSET core's resolution reads. Apps intersect their own fields onto it; core ignores them. |
| `ResolvedProvider` | `{ name: string; model?: string; apiKey?: string; baseURL?: string }` | The resolved real provider. `model` optional only for `modelOptional` CLI kinds; an app's log entry records this as `provider`. |
| `ProviderEntry` | type, re-exported from `wrap-core/llm` registry | Re-exported so `wrap-core/config` is one coherent import surface for everything turning a config file into an Llm. |
| `ConfigError` | `Error` subclass | Bare plain-language message, no category prefix. Thrown only by `loadJsoncConfig`. |

## Pitfalls

- **`ProvidersConfig` (here) vs `ProviderConfig` (`wrap-core/llm`).** Plural = the config that *carries* a providers map (`{providers?, defaultProvider?}`); singular = ONE resolved provider (`{name} & ProviderEntry`). Both consumers import both surfaces — keep them straight.
- **Env override is shallow.** A nested object in the env JSON replaces the file's wholesale; it does not deep-merge. A whitespace-only env var counts as absent.
- **Errors are bare.** No prefix, no remediation — the consumer voices them. Don't surface a `ConfigError`/`LlmConfigError` message raw to a user.
