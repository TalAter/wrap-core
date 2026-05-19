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

`app` must match `/^[a-z][a-z0-9-]*$/` — the factory throws on invalid input. POSIX env-var names require a letter-led identifier, and both real consumers fit easily.

`AppHome` is constructed once per process and treated as a fixed handle: `root` is captured at construction, not lazy. Wrap runs against a single home for its whole lifetime; tests that need a different home construct a fresh `AppHome` rather than mutating env mid-run.

Resolution precedence at construction: `opts.home ?? env[derive(app)] ?? join(homedir(), "." + app)`. `home` is an absolute override that bypasses env entirely.

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
// wrap/src/fs/home.ts (post-promotion)
import { createAppHome } from "wrap-core/fs";
export const wrapFs = createAppHome({ app: "wrap" });
```

Callers import `wrapFs` from their own wrap-side module. `cache.ts`'s `getWrapHome()` becomes `wrapFs.root`. The file itself stays — it's the wrap-side bind site for `wrapFs`. If wrap later wants additional wrap-specific filesystem bits in the same file (a `wrapPaths` constants object, for example), they live here too; otherwise it really is just an import + export const.

## Out of scope

- JSONL append/iterate helpers. Both consumers compose `JSON.stringify + '\n'` and `split + parse` themselves over fs primitives. Promote when a second consumer's real use proves an abstraction earns its keep.
- Sweep's `installed.json` registry (sweep-side).
- `wrap/src/logging/{writer,lookup,entry}.ts` — wrap-specific, stay in wrap. Only their import of the home helpers swings.
- `wrap/src/fs/cache.ts` — wrap-specific sibling that imports `getWrapHome` / `readWrapFile` / `writeWrapFile` from `./home.ts`; swings to `wrapFs.root` / `wrapFs.read` / `wrapFs.write` but does not promote.
- `wrap/src/fs/temp.ts` — does not import `home.ts` at all (independent `$TMPDIR`-based helper). Untouched by this promotion.
- Log rotation, incremental cursors, multi-writer locking.

## Step plan

Each step leaves all three repos green (`bun run check`). "Atomic across repos" = one commit per touched repo, landed together at a green checkpoint; there is no shared transaction across the three git repos. Within a step, bullets are an inventory of what must be true at the end of the step, not a strict execution order — implementations may interleave (e.g. in Step 2, the per-caller swing typically happens before `home.ts` collapses to the one-liner, since the old named functions need to still resolve until the last caller flips).

TDD inside a step: write the failing test before the implementation. Test and implementation land in the **same commit** for that step (so the commit boundary stays green) — "test first" is a workflow discipline within the step, not a separate commit.

**Step 1 — wrap-core skeleton.** Land `createAppHome` and its tests in wrap-core. Nothing else changes.
- `wrap-core/src/fs/index.ts` with the factory.
- `wrap-core/package.json` adds the first `exports` entry: `"./fs": "./src/fs/index.ts"`.
- `wrap-core/tests/helpers.ts` (created this step — first general test helper). Sole export is `tmpHome()`: `mkdtempSync(join(tmpdir(), "wrap-core-test-"))`. Do NOT copy the rest of `wrap/tests/helpers.ts` (`seedTestConfig`, `isolateEnv`, etc. depend on wrap-side config modules that don't exist in core). Handbook: "general helpers (used by 2+ test files) live at `wrap-core/tests/helpers.ts` — single shared file."
- `wrap-core/tests/fs-home.test.ts` — moved + rewritten from `wrap/tests/fs-home.test.ts` (test-first; lands red before implementation, green after). Only the env-var-derivation / default-dir test is parameterized over `app: "wrap"` and `app: "sweep"` (the part that actually differs across apps). The IO suite (read/write/append/exists/resolve round-trips) runs once under `app: "wrap"` — duplicating it across apps would double runtime for behavior that doesn't branch on `app`. Tests construct each `AppHome` with an explicit `home: tmpHome()` — no `process.env` mutation needed.
- Register wrap-core globally for bun-link: from the **main wrap-core checkout** (`~/mysite/wrap-core/`, not a worktree under `.claude/worktrees/`), run `bun install` then `bun link` once. This is a per-machine, one-time setup — registration survives across consumer installs and is the precondition for consumer-side `bun link wrap-core` in steps 2/3. Running from a worktree would register the worktree's transient path.
- `wrap-core/vault/wrap-core-api/fs.md` — consumer-facing api note (frontmatter, one-paragraph purpose, public-symbols table, pointer to internals at the bottom — per handbook §Vault).
- wrap and sweep untouched.

**Step 2 — wrap callers swing to `wrapFs`.** Wrap consumes wrap-core. This is a refactor, not a rename — wrap-side signatures that exist only to support test home-injection (e.g. `loadMemory(wrapHome)`, `appendLogEntry(wrapHome, ...)`, `ensureConfig(env, home)`, `cacheAppearance(appearance, home)`) **lose their `wrapHome` / `home` parameter** and reach for `wrapFs` directly. The home is now a process-wide singleton: wrap runs against one home, decided at startup, never overwritten mid-run. Tests that previously mutated `process.env.WRAP_HOME` post-import (`tests/fs-cache.test.ts`, `tests/editor.test.ts`, `tests/main-version-osc.test.ts`) refactor accordingly — typical pattern is to set `$WRAP_HOME=<tmpHome()>` in the test file *before* importing any wrap module, or to test the underlying `wrap-core/fs` helpers directly when the wrap-side wrapper adds no value.
- `wrap/package.json` adds `"wrap-core": "link:wrap-core"`. Then in `wrap/` run `bun link wrap-core` once to install the symlink into `node_modules/wrap-core/`. (Precondition: wrap-core was registered via `bun link` in step 1.)
- `wrap/src/fs/home.ts` becomes the two-line `wrapFs` bind site shown in §Capability. No re-export shim of the old named functions.
- Every wrap-side caller of the old named functions updates to `wrapFs.read/write/append/resolve` or `wrapFs.root`. Two grep passes — the inter-module callers and the in-`fs/` sibling — together give 13 files:
  - `grep -rl 'fs/home' wrap/src/` — 12 files importing via `../fs/home` or `../../fs/home`: `core/editor.ts`, `core/detect-appearance.ts`, `memory/memory.ts`, `main.ts`, `config/ensure.ts`, `config/config.ts`, `subcommands/log.ts`, `subcommands/forget.ts`, `discovery/watchlist.ts`, `wizard/write-config.ts`, `logging/writer.ts`, `session/session.ts`.
  - `wrap/src/fs/cache.ts` — imports `./home.ts` (relative within `fs/`), so not caught by the first grep. Its `getWrapHome()` → `wrapFs.root`; its `readWrapFile`/`writeWrapFile` calls → `wrapFs.read`/`wrapFs.write`.
  - `wrap/src/fs/temp.ts` does NOT import from `home.ts` and stays untouched.
- `wrap/tests/fs-home.test.ts` deleted (covered by core; transitively exercised by wrap's other tests).
- `wrap/vault/wrap-core-api` symlink → `../node_modules/wrap-core/vault/wrap-core-api/` (committed; from `wrap/`, run `ln -s ../node_modules/wrap-core/vault/wrap-core-api vault/wrap-core-api`. The `../` is required — the symlink lives at `wrap/vault/`, so its target is resolved relative to that dir).
- `wrap/CLAUDE.md` gains the wrap-core pointer block (handbook §Cross-package LLM context).
- `bun run check` green in wrap-core and wrap.

**Step 3 — sweep bootstrap.** First substrate use from sweep's side.
- `sweep/package.json` gets `"wrap-core": "link:wrap-core"`. Then in `sweep/` run `bun link wrap-core` to install the symlink. Mirror wrap's `tsconfig.json` / `biome.json` / `bunfig.toml` setup (per `sweep/CLAUDE.md`'s "mirror wrap" guidance).
- `sweep/vault/wrap-core-api` symlink committed (from `sweep/`, run `ln -s ../node_modules/wrap-core/vault/wrap-core-api vault/wrap-core-api`).
- `sweep/CLAUDE.md` already carries the wrap-core pointer block — no edit needed (added when sweep was scaffolded).
- `sweep/src/fs/home.ts` (or wherever sweep wants the handle to live — sweep's choice): `export const sweepFs = createAppHome({ app: "sweep" })`.
- `sweep/tests/sweep-fs.test.ts` — minimal acceptance: write a JSONL line via `sweepFs.append("logs/sweep.jsonl", JSON.stringify(...) + "\n")`, read it back via `sweepFs.read`, parse, verify shape. Uses an explicit `home` override under a tmp dir so it doesn't touch `~/.sweep/`.
- `bun run check` green in all three repos.

## Acceptance

- Both wrap and sweep consume `createAppHome` from `wrap-core/fs`. No implementation of the helpers remains in wrap — `wrap/src/fs/home.ts` exports `wrapFs` (the `createAppHome` construction) plus any wrap-specific filesystem extras that earn their place there, and nothing else.
- `bun run check` is green in all three repos at every step boundary (per the atomic-commit rule in the [wrap-core handbook](../README.md)).
- Wrap's externally observable behavior is unchanged — same paths on disk, same JSONL format (still produced by wrap's own `writer.ts` on top of core's fs primitives), same error semantics for existing callers. `$WRAP_HOME` continues to point wrap at the same dir for existing users.
- Sweep can write a JSONL line to `~/.sweep/logs/sweep.jsonl` and read it back using only wrap-core fs APIs (verified by a test in `sweep/tests/`).
- Tests for the promoted code move with the code into `wrap-core/tests/`. Only the env-var-derivation / default-dir test is parameterized across `app: "wrap"` and `app: "sweep"`; the IO suite runs once. No wrap-side duplicate.
- `wrap-core/vault/wrap-core-api/fs.md` lands; each consumer's `vault/wrap-core-api` symlink is committed.
