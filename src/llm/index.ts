// LLM module — one capability: have a multi-turn structured conversation
// with an LLM. `createLlm` is the front door; the provider registry rides
// along for consumer config/wizard surfaces. Internal seams (adapters, the
// send engine, conversation state, the test provider factory) stay private —
// the test kind is reachable as data via createLlm({ name: "test", … }).
// See vault/impl-specs/llm.md.

export type {
  AddOptions,
  Attempt,
  AttemptError,
  AttemptRequest,
  Entry,
  LlmMessage,
} from "./conversation.ts";
export { replayable } from "./conversation.ts";
export type { Llm, LlmConfig, ProviderConfig, TestProviderConfig } from "./create-llm.ts";
export { createLlm } from "./create-llm.ts";
export {
  LlmAbortError,
  LlmConfigError,
  LlmParseError,
  LlmProviderError,
} from "./errors.ts";
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
export type {
  Conversation,
  ConversationOptions,
  EchoPredicate,
  SendOptions,
} from "./send.ts";
export type { TestResponse, TestResponses } from "./test-provider.ts";
// Wire shapes are public because they ride inside persisted `Attempt`s —
// consumers reading their own durable records need the types.
export type { WirePair, WireRequest, WireResponse } from "./wires.ts";
