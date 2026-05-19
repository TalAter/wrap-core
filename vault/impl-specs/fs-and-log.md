---
name: fs-and-log
description: First promotion to wrap-core — app-home filesystem helpers — pulled by sweep v0. (Log/JSONL helpers deliberately out of scope; see Out of scope.)
---

# fs-and-log

First concrete promotion from wrap into wrap-core. Triggered by sweep v0, which needs the same filesystem substrate wrap already uses under `~/.wrap/`.

> **Scope note.** The spec was originally drafted to also promote a thin JSONL "log" capability. After review, that was cut as premature abstraction: JSONL is `JSON.stringify(obj) + '\n'` on append and `split + try/catch parse` on read — too thin to share until a second consumer's actual use earns the abstraction. Wrap's `writer.ts` / `lookup.ts` / `entry.ts` stay 100% in wrap. The file name is kept for git-history continuity.

## Why now

Sweep is starting from scratch. Its v0 persists multiple things under `~/.sweep/`: fetched install scripts (`scripts/<sha256>`), an `installed.json` registry (sweep-side, out of scope here), and an append-only `logs/sweep.jsonl` history.

Wrap already has the exact "files under an app-home dir" primitives — `getWrapHome` / `readWrapFile` / `writeWrapFile` / `appendWrapFile` in `wrap/src/fs/home.ts`. Hardcoded to wrap's identity. Promoting now means sweep doesn't fork-and-diverge from day one, and forces the first generic-ization through wrap-core.

## Capability: app-home filesystem

Each consumer has its own home directory under `$HOME/.<app>` (default) or `$<APP>_HOME` (env override). Env-var name derives from the app name: uppercased, `-` → `_`. So `app: "wrap"` reads `$WRAP_HOME`, default `~/.wrap`. `app: "sweep"` reads `$SWEEP_HOME`, default `~/.sweep`.

Behaviors:

- Resolve any path *under* home.
- Read a file; missing returns `null` (not throw). Other errors (e.g. EISDIR, EACCES) rethrow — pinned by wrap's existing tests.
- Write or append text; parent directories created on demand.
- Check existence.

### Surface

```ts
// wrap-core/src/fs/index.ts
export type AppHome = {
  root: string;
  resolve(relPath: string): string;
  read(relPath: string): string | null;
  write(relPath: string, content: string): void;
  append(relPath: string, content: string): void;
  exists(relPath: string): boolean;
};

export function createAppHome(opts: {
  app: string;                                  // e.g. "wrap", "sweep"
  home?: string;                                // explicit override, primarily for tests
  env?: Record<string, string | undefined>;     // env source, default process.env
}): AppHome;
```

App identity is explicit at the API surface — wrap-core has no hardcoded knowledge of `wrap` or `sweep`. Each consumer wires its own handle once:

```ts
// wrap/src/fs/home.ts (post-promotion — becomes a one-liner)
import { createAppHome } from "wrap-core/fs";
export const wrapFs = createAppHome({ app: "wrap" });
```

Callers import `wrapFs` from their own wrap-side module. `cache.ts`'s `getWrapHome()` becomes `wrapFs.root`.

## Out of scope

- JSONL append/iterate helpers. Both consumers compose `JSON.stringify + '\n'` and `split + parse` themselves over fs primitives. Promote when a second consumer's real use proves an abstraction earns its keep.
- Sweep's `installed.json` registry (sweep-side).
- `wrap/src/logging/{writer,lookup,entry}.ts` — wrap-specific, stay in wrap. Only their import of the home helpers swings.
- `wrap/src/fs/cache.ts` and `wrap/src/fs/temp.ts` — wrap-specific siblings; they update their import to use `wrapFs` but do not promote.
- Log rotation, incremental cursors, multi-writer locking.

## Step plan

Each step leaves all three repos green (`bun run check`). One coordinated commit-set per step, atomic across the repos it touches.

**Step 1 — wrap-core skeleton.** Land `createAppHome` and its tests in wrap-core. Nothing else changes.
- `wrap-core/src/fs/index.ts` with the factory.
- `wrap-core/package.json` adds the first `exports` entry: `"./fs": "./src/fs/index.ts"`.
- `wrap-core/tests/helpers.ts` (created this step — first general test helper) exports `tmpHome()`: `mkdtempSync(join(tmpdir(), "wrap-core-test-"))`. Equivalent to wrap's `tmpHome()` in `wrap/tests/helpers.ts`. Handbook: "general helpers (used by 2+ test files) live at `wrap-core/tests/helpers.ts` — single shared file."
- `wrap-core/tests/fs-home.test.ts` — TDD-first within the step: moved + rewritten from `wrap/tests/fs-home.test.ts`, parameterized over `app: "wrap"` and `app: "sweep"` (covers both env-var derivations and dir-name defaults). Tests pass `env: { [VAR]: tmpHome() }` directly to `createAppHome` — no `process.env` mutation needed now that `env` is a parameter.
- Register wrap-core globally for bun-link: in `wrap-core/` run `bun link` once. This is the precondition for consumer-side `bun link wrap-core` in steps 2/3.
- `wrap-core/vault/wrap-core-api/fs.md` — consumer-facing api note (frontmatter, one-paragraph purpose, public-symbols table, pointer to internals at the bottom — per handbook §Vault).
- wrap and sweep untouched.

**Step 2 — wrap callers swing to `wrapFs`.** Wrap consumes wrap-core.
- `wrap/package.json` adds `"wrap-core": "link:wrap-core"`. Then in `wrap/` run `bun link wrap-core` once to install the symlink into `node_modules/wrap-core/`. (Precondition: wrap-core was registered via `bun link` in step 1.)
- `wrap/src/fs/home.ts` shrinks to a single line: `export const wrapFs = createAppHome({ app: "wrap" });`. No re-export shim.
- Every wrap-side caller of the old named functions updates to `wrapFs.read/write/append/resolve` or `wrapFs.root`. Find them with: `rg "from ['\"]\.\.?/.*fs/home" wrap/src/` — ~12 files. `cache.ts`'s `getWrapHome()` → `wrapFs.root`.
- `wrap/tests/fs-home.test.ts` deleted (covered by core; transitively exercised by wrap's other tests).
- `wrap/vault/wrap-core-api` symlink → `node_modules/wrap-core/vault/wrap-core-api/` (committed; `ln -s node_modules/wrap-core/vault/wrap-core-api vault/wrap-core-api`).
- `wrap/CLAUDE.md` gains the wrap-core pointer block (handbook §Cross-package LLM context).
- `bun run check` green in wrap-core and wrap.

**Step 3 — sweep bootstrap.** First substrate use from sweep's side.
- `sweep/package.json` gets `"wrap-core": "link:wrap-core"`. Then in `sweep/` run `bun link wrap-core` to install the symlink. Mirror wrap's `tsconfig.json` / `biome.json` / `bunfig.toml` setup (per `sweep/CLAUDE.md`'s "mirror wrap" guidance).
- `sweep/vault/wrap-core-api` symlink committed.
- `sweep/src/fs/home.ts` (or wherever sweep wants the handle to live — sweep's choice): `export const sweepFs = createAppHome({ app: "sweep" })`.
- `sweep/tests/sweep-fs.test.ts` — minimal acceptance: write a JSONL line via `sweepFs.append("logs/sweep.jsonl", JSON.stringify(...) + "\n")`, read it back via `sweepFs.read`, parse, verify shape. Uses an explicit `home` override under a tmp dir so it doesn't touch `~/.sweep/`.
- `bun run check` green in all three repos.

## Acceptance

- Both wrap and sweep consume `createAppHome` from `wrap-core/fs`. No copy of the helpers remains in wrap.
- `bun run check` is green in all three repos at every step boundary (per the atomic-commit rule in the [wrap-core handbook](../README.md)).
- Wrap's externally observable behavior is unchanged — same paths on disk, same JSONL format (still produced by wrap's own `writer.ts` on top of core's fs primitives), same error semantics for existing callers. `$WRAP_HOME` continues to point wrap at the same dir for existing users.
- Sweep can write a JSONL line to `~/.sweep/logs/sweep.jsonl` and read it back using only wrap-core fs APIs (verified by a test in `sweep/tests/`).
- Tests for the promoted code move with the code into `wrap-core/tests/`, parameterized across `app: "wrap"` and `app: "sweep"`. No wrap-side duplicate.
- `wrap-core/vault/wrap-core-api/fs.md` lands; each consumer's `vault/wrap-core-api` symlink is committed.
