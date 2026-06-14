import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
// Deliberately the public surface: everything here imports through
// src/config/index.ts, the import path consumers reach.
import {
  ConfigError,
  llmFromResolved,
  loadJsoncConfig,
  type ProvidersConfig,
  resolveProvider,
} from "../src/config/index.ts";
import { createAppFs } from "../src/fs/index.ts";
import { LlmConfigError } from "../src/llm/index.ts";
import { tmpHome } from "./helpers.ts";

const trackedHomes: string[] = [];
function freshHome(): string {
  const home = tmpHome();
  trackedHomes.push(home);
  return home;
}
afterEach(() => {
  while (trackedHomes.length) {
    const home = trackedHomes.pop();
    if (home) rmSync(home, { recursive: true, force: true });
  }
});

function newFs() {
  const home = freshHome();
  return { home, fs: createAppFs({ app: "wrap", home }) };
}

/** Run `fn`, assert it threw the given error class, hand back its message. */
function errorMessage(fn: () => unknown, ctor: new (...args: never[]) => Error): string {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ctor);
    return (error as Error).message;
  }
  throw new Error("expected the call to throw");
}

describe("loadJsoncConfig", () => {
  test("absent file → {}", () => {
    const { fs } = newFs();
    expect(loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc")).toEqual({});
  });

  test("valid jsonc with a comment and a trailing comma → parsed object", () => {
    const { fs } = newFs();
    fs.write(
      "config.jsonc",
      `{
        // the default provider
        "defaultProvider": "anthropic",
        "providers": {
          "anthropic": { "model": "claude-sonnet-4-6", },
        },
      }`,
    );
    expect(loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc")).toEqual({
      defaultProvider: "anthropic",
      providers: { anthropic: { model: "claude-sonnet-4-6" } },
    });
  });

  test("invalid jsonc → ConfigError naming the file", () => {
    const { fs } = newFs();
    fs.write("config.jsonc", "{ not valid");
    expect(errorMessage(() => loadJsoncConfig(fs, "config.jsonc"), ConfigError)).toBe(
      "config.jsonc contains invalid JSON.",
    );
  });

  test("env override present + valid → shallow-merged over file, env wins top-level", () => {
    const { fs } = newFs();
    fs.write(
      "config.jsonc",
      `{ "defaultProvider": "anthropic", "providers": { "anthropic": { "model": "a" } } }`,
    );
    const merged = loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc", {
      envOverrideVar: "WRAP_CONFIG",
      env: { WRAP_CONFIG: '{ "defaultProvider": "openai" }' },
    });
    // env wins at the top level; the nested providers object is not deep-merged
    // away — it survives because env didn't supply that key.
    expect(merged).toEqual({
      defaultProvider: "openai",
      providers: { anthropic: { model: "a" } },
    });
  });

  test("env override replaces nested objects entirely (no deep merge)", () => {
    const { fs } = newFs();
    fs.write("config.jsonc", `{ "providers": { "anthropic": { "model": "a" } } }`);
    const merged = loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc", {
      envOverrideVar: "WRAP_CONFIG",
      env: { WRAP_CONFIG: '{ "providers": { "openai": { "model": "b" } } }' },
    });
    expect(merged).toEqual({ providers: { openai: { model: "b" } } });
  });

  test("env override invalid JSON → ConfigError naming the var", () => {
    const { fs } = newFs();
    fs.write("config.jsonc", "{}");
    expect(
      errorMessage(
        () =>
          loadJsoncConfig(fs, "config.jsonc", {
            envOverrideVar: "WRAP_CONFIG",
            env: { WRAP_CONFIG: "{ not json" },
          }),
        ConfigError,
      ),
    ).toBe("WRAP_CONFIG contains invalid JSON.");
  });

  test("env override absent or whitespace → file config only", () => {
    const { fs } = newFs();
    fs.write("config.jsonc", `{ "defaultProvider": "anthropic" }`);
    const opts = { envOverrideVar: "WRAP_CONFIG" } as const;
    expect(loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc", { ...opts, env: {} })).toEqual({
      defaultProvider: "anthropic",
    });
    expect(
      loadJsoncConfig<ProvidersConfig>(fs, "config.jsonc", {
        ...opts,
        env: { WRAP_CONFIG: "   " },
      }),
    ).toEqual({ defaultProvider: "anthropic" });
  });

  test("ConfigError messages are bare — no category prefix", () => {
    const { fs } = newFs();
    fs.write("config.jsonc", "{ broken");
    const msg = errorMessage(() => loadJsoncConfig(fs, "config.jsonc"), ConfigError);
    expect(msg).not.toMatch(/Config error:/);
    expect(msg).not.toMatch(/sweep:/);
  });
});

describe("resolveProvider", () => {
  test("happy path → ResolvedProvider with name, model, apiKey", () => {
    const config: ProvidersConfig = {
      defaultProvider: "anthropic",
      providers: { anthropic: { model: "claude-sonnet-4-6", apiKey: "sk-x" } },
    };
    expect(resolveProvider(config)).toEqual({
      name: "anthropic",
      model: "claude-sonnet-4-6",
      apiKey: "sk-x",
      baseURL: undefined,
    });
  });

  test("defaultProvider unset → bare 'no LLM configured.'", () => {
    expect(errorMessage(() => resolveProvider({}), LlmConfigError)).toBe("no LLM configured.");
  });

  test("default names a missing entry → bare 'not found' message", () => {
    const config: ProvidersConfig = { defaultProvider: "x", providers: {} };
    expect(errorMessage(() => resolveProvider(config), LlmConfigError)).toBe(
      'provider "x" not found in config.',
    );
  });

  test("registry validation surfaces bare (ollama without baseURL)", () => {
    const config: ProvidersConfig = {
      defaultProvider: "ollama",
      providers: { ollama: { model: "llama3" } },
    };
    expect(errorMessage(() => resolveProvider(config), LlmConfigError)).toBe(
      'provider "ollama" requires baseURL.',
    );
  });

  test("aiSDK provider with no model → bare 'no model set' message", () => {
    const config: ProvidersConfig = {
      defaultProvider: "anthropic",
      providers: { anthropic: { apiKey: "sk-x" } },
    };
    expect(errorMessage(() => resolveProvider(config), LlmConfigError)).toBe(
      'provider "anthropic" has no model set in config.',
    );
  });

  test("claude-code with no model resolves (modelOptional)", () => {
    const config: ProvidersConfig = {
      defaultProvider: "claude-code",
      providers: { "claude-code": {} },
    };
    expect(resolveProvider(config)).toEqual({
      name: "claude-code",
      model: undefined,
      apiKey: undefined,
      baseURL: undefined,
    });
  });

  test("all resolveProvider error messages are bare — no 'Config error:' / '~/.wrap'", () => {
    const cases: ProvidersConfig[] = [
      {},
      { defaultProvider: "x", providers: {} },
      { defaultProvider: "ollama", providers: { ollama: { model: "llama3" } } },
      { defaultProvider: "anthropic", providers: { anthropic: { apiKey: "sk-x" } } },
    ];
    for (const config of cases) {
      const msg = errorMessage(() => resolveProvider(config), LlmConfigError);
      expect(msg).not.toMatch(/Config error:/);
      expect(msg).not.toMatch(/~\/\.wrap/);
    }
  });
});

describe("llmFromResolved", () => {
  test("real provider → Llm with 'name / model' label", () => {
    const llm = llmFromResolved({ name: "openai", model: "gpt-5", apiKey: "sk-x" });
    expect(llm.label).toBe("openai / gpt-5");
  });

  test("$UNSET_VAR apiKey throws LlmConfigError (delegated to createLlm)", () => {
    delete process.env.WRAP_CORE_NO_SUCH_KEY_CONFIG_TEST;
    expect(
      errorMessage(
        () =>
          llmFromResolved({
            name: "anthropic",
            model: "claude-sonnet-4-6",
            apiKey: "$WRAP_CORE_NO_SUCH_KEY_CONFIG_TEST",
          }),
        LlmConfigError,
      ),
    ).toBe("environment variable WRAP_CORE_NO_SUCH_KEY_CONFIG_TEST is not set.");
  });
});
