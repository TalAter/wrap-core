// LLM module — provider registry. More of the surface (conversation, provider
// factories) lands in later promotion units; see vault/impl-specs/llm.md.

export type {
  ApiProvider,
  CliProvider,
  ProviderEntry,
  ProviderKind,
  ProviderRegistration,
} from "./registry.ts";
export {
  API_PROVIDERS,
  CLI_PROVIDERS,
  getRegistration,
  isCliProvider,
  isKnownProvider,
  providerNeedsApiKey,
  validateProviderEntry,
} from "./registry.ts";
