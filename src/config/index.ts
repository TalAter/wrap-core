// Config module — config-file ingestion + real-provider resolution, lifted
// from wrap so wrap and sweep share one copy. Core stays
// app-agnostic: consumers name their own filename and env-override var, and
// dress core's bare error messages in their own voice. `ProviderEntry`
// re-exports from the LLM registry so `wrap-core/config` is one coherent
// import surface for everything an app needs to turn a config file into an Llm.

export type { ProviderEntry } from "../llm/registry.ts";
export { ConfigError, loadJsoncConfig } from "./load.ts";
export type { ProvidersConfig, ResolvedProvider } from "./provider.ts";
export { llmFromResolved, resolveProvider } from "./provider.ts";
