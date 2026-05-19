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

`app` must match `/^[a-z][a-z0-9-]*$/` — the factory throws `Error` with message `"createAppHome: invalid app name <value>"` on invalid input. Validation runs regardless of whether `opts.home` is supplied (the `app` is identity at the API surface, not just an env-key input). POSIX env-var names require a letter-led identifier, and both real consumers fit easily.

`AppHome` is constructed once per process and treated as a fixed handle: `root` is captured at construction, not lazy. Wrap runs against a single home for its whole lifetime; tests that need a different home construct a fresh `AppHome` rather than mutating env mid-run.

Resolution precedence at construction: `opts.home || env[derive(app)] || join(homedir(), "." + app)`. `||` (not `??`) is deliberate — empty string is treated as unset at every level, matching wrap's existing `getWrapHome` behavior (pinned by `wrap/tests/fs-home.test.ts:25` "falls back to ~/.wrap when WRAP_HOME is unset, undefined, or empty"). `opts.home`, when non-empty, must be an absolute path; the factory throws if it is not. The constructor does not create `root` on disk — `root` may not exist until a write transitively `mkdir -p`s it.

Behaviors (all sync, utf-8 text):

- `resolve(relPath)` — returns `join(root, relPath)`. No `..`-escape guarding (matches wrap's current behavior — callers are trusted).
- `read(relPath)` — returns the file contents; an existing empty file returns `""`. A missing file returns `null` (not throw). Other errors (e.g. EISDIR, EACCES) rethrow — pinned by `wrap/tests/fs-home.test.ts`.
- `write(relPath, content)` — writes `content` to the file, creating parent directories as needed. Overwrites any existing content.
- `append(relPath, content)` — appends `content`, also creating parent directories as needed. Single-process append only; cross-process ordering relies on POSIX `O_APPEND` semantics.
- `exists(relPath)` — returns `true` for any existing path under `root` (file, directory, or symlink), `false` otherwise.

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

Callers import `wrapFs` from their own wrap-side module. `cache.ts`'s `getWrapHome()` becomes `wrapFs.root`. The file itself stays as the wrap-side bind site for `wrapFs` — really just an import + export const.

## Out of scope

- JSONL append/iterate helpers. Both consumers compose `JSON.stringify + '\n'` and `split + parse` themselves over fs primitives. Promote when a second consumer's real use proves an abstraction earns its keep.
- Sweep's `installed.json` registry (sweep-side).
- `wrap/src/logging/{writer,lookup,entry}.ts` — wrap-specific, stay in wrap. Only their import of the home helpers swings in Step 2.
- `wrap/src/fs/cache.ts` — stays in wrap (not a promotion candidate). Its callsites still swing in Step 2: `getWrapHome` → `wrapFs.root`, `readWrapFile`/`writeWrapFile` → `wrapFs.read`/`wrapFs.write`.
- `wrap/src/fs/temp.ts` — does not import `home.ts` at all (independent `$TMPDIR`-based helper). Untouched by this promotion.
- Log rotation, incremental cursors, multi-writer locking.
- New uses of `exists()` in wrap. The two current `existsSync` callsites (`wrap/src/subcommands/log.ts`, `wrap/src/logging/lookup.ts`) stay on `node:fs` for now; `exists()` is exposed for sweep's use and migrating wrap is a separate, lower-priority swing.

## Step plan

Each step leaves all three repos green (`bun run check`). "Atomic across repos" = one commit per touched repo, landed together at a green checkpoint; there is no shared transaction across the three git repos. Within a step, bullets are an inventory of what must be true at the end of the step, not a strict execution order — implementations may interleave (e.g. in Step 2, the per-caller swing typically happens before `home.ts` collapses to the one-liner, since the old named functions need to still resolve until the last caller flips).

TDD inside a step: write the failing test before the implementation. Test and implementation land in the **same commit** for that step (so the commit boundary stays green) — "test first" is a workflow discipline within the step, not a separate commit.

**Step 1 — wrap-core skeleton.** Land `createAppHome` and its tests in wrap-core. Nothing else changes.
- `wrap-core/src/fs/index.ts` with the factory.
- `wrap-core/package.json` adds the first `exports` entry: `"./fs": "./src/fs/index.ts"`.
- `wrap-core/tests/helpers.ts` (created this step — first general test helper). Sole export is `tmpHome()`: returns `mkdtempSync(join(tmpdir(), "wrap-core-test-"))`. Cleanup is per-test via `afterEach(() => rmSync(home, { recursive: true, force: true }))` in each test file; the helper itself doesn't register hooks (callers track the dir they got back). Do NOT copy the rest of `wrap/tests/helpers.ts` (`seedTestConfig`, `isolateEnv`, etc. depend on wrap-side config modules that don't exist in core). Handbook: "general helpers (used by 2+ test files) live at `wrap-core/tests/helpers.ts` — single shared file."
- `wrap-core/tests/fs-home.test.ts` — moved + rewritten from `wrap/tests/fs-home.test.ts` (test-first; lands red before implementation, green after). The env-var-derivation / default-dir test is parameterized over `app: "wrap"`, `app: "sweep"`, and `app: "my-tool"` (the last pins the `-` → `_` derivation rule). The IO suite (read/write/append/exists/resolve round-trips) runs once under `app: "wrap"` — `"wrap"` here is just an arbitrary valid app name; core has no hardcoded knowledge of it. Tests construct each `AppHome` with an explicit `home: tmpHome()` — no `process.env` mutation needed. Coverage must include the assertions that exist in wrap's current `fs-home.test.ts` (env unset/undefined/empty-string all fall back to default; `opts.home` overrides env; missing-file → `null`; EISDIR rethrows; nested-mkdir write; append-creates-then-appends), plus the new behaviors added here: `app`-regex throw, non-absolute `opts.home` throw, `exists` returns `true` for both files and dirs.
- Register wrap-core globally for bun-link: from the **main wrap-core checkout** (`~/mysite/wrap-core/`, not a worktree under `.claude/worktrees/`), run `bun install` then `bun link` once. Verify with `bun pm ls -g | grep wrap-core` — output should show `~/mysite/wrap-core`. This is a per-machine, one-time setup — registration survives across consumer installs and is the precondition for consumer-side `bun link wrap-core` in steps 2/3. Running from a worktree would register the worktree's transient path; if done by mistake, `bun unlink` from the worktree, then re-run `bun link` from the main checkout.
- `wrap-core/vault/wrap-core-api/fs.md` — consumer-facing api note (frontmatter, one-paragraph purpose, public-symbols table, pointer to internals at the bottom — per handbook §Vault).
- wrap and sweep untouched.

**Step 2 — wrap callers swing to `wrapFs`.** Wrap consumes wrap-core. This is a refactor, not a rename — wrap-side signatures that exist only to support test home-injection (e.g. `loadMemory(wrapHome)`, `appendLogEntry(wrapHome, ...)`, `ensureConfig({ WRAP_HOME })`, `cacheAppearance(appearance, home?)`) **lose their `wrapHome` / `home` / `WRAP_HOME` parameter** and reach for `wrapFs` directly. Audit surface for these: `grep -rn 'home: string\|home?: string\|WRAP_HOME' wrap/src/` and review every hit. The home is now a process-wide singleton: wrap runs against one home, decided at startup, never overwritten mid-run. Tests that previously mutated `process.env.WRAP_HOME` in `beforeEach`/`beforeAll` (`tests/fs-cache.test.ts`, `tests/editor.test.ts`, `tests/main-version-osc.test.ts`) refactor to one of these two patterns: (a) set `process.env.WRAP_HOME = tmpHome()` at the very top of the test file before any wrap import, since Bun evaluates each test file in a fresh process (`bun test` default), or (b) drop the wrap-side test entirely and let the wrap-core `fs-home.test.ts` cover the behavior when the wrap-side wrapper adds no value. Pick (a) when the test exercises wrap-specific logic on top of fs; pick (b) when the test only exercises the fs primitive itself.
- `wrap/package.json` adds `"wrap-core": "link:wrap-core"`. Then in `wrap/` run `bun link wrap-core` once to install the symlink into `node_modules/wrap-core/`. (Precondition: wrap-core was registered via `bun link` in step 1.)
- `wrap/src/fs/home.ts` becomes the two-line `wrapFs` bind site shown in §Capability. No re-export shim of the old named functions.
- Every wrap-side caller of the old named functions updates to `wrapFs.read/write/append/resolve` or `wrapFs.root`. Two grep passes — the inter-module callers and the in-`fs/` sibling — together give 13 files:
  - `grep -rl 'fs/home' wrap/src/` — 12 files importing via `../fs/home` or `../../fs/home`: `core/editor.ts`, `core/detect-appearance.ts`, `memory/memory.ts`, `main.ts`, `config/ensure.ts`, `config/config.ts`, `subcommands/log.ts`, `subcommands/forget.ts`, `discovery/watchlist.ts`, `wizard/write-config.ts`, `logging/writer.ts`, `session/session.ts`.
  - `wrap/src/fs/cache.ts` — imports `./home.ts` (relative within `fs/`), so not caught by the first grep. Its `getWrapHome()` → `wrapFs.root`; its `readWrapFile`/`writeWrapFile` calls → `wrapFs.read`/`wrapFs.write`.
  - `wrap/src/fs/temp.ts` does NOT import from `home.ts` and stays untouched.
- `wrap/tests/fs-home.test.ts` deleted (covered by core; transitively exercised by wrap's other tests).
- `wrap/vault/wrap-core-api` symlink → `../node_modules/wrap-core/vault/wrap-core-api/` (committed). Symlink targets are resolved relative to the directory the symlink **lives in** (`wrap/vault/`), not the cwd of the command — that's why the target starts with `../`. From `wrap/`, run `ln -s ../node_modules/wrap-core/vault/wrap-core-api vault/wrap-core-api`. If `vault/wrap-core-api` already exists (e.g. a stale dir from manual prep), `rm -rf` it first.
- `wrap/CLAUDE.md` gains the wrap-core pointer block (handbook §Cross-package LLM context).
- `bun run check` green in wrap-core and wrap.

**Step 3 — sweep bootstrap.** First substrate use from sweep's side.
- `sweep/package.json` gets `"wrap-core": "link:wrap-core"`. Then in `sweep/` run `bun link wrap-core` to install the symlink. Mirror wrap's `tsconfig.json` / `biome.json` / `bunfig.toml` setup (per `sweep/CLAUDE.md`'s "mirror wrap" guidance).
- `sweep/vault/wrap-core-api` symlink committed (from `sweep/`, run `ln -s ../node_modules/wrap-core/vault/wrap-core-api vault/wrap-core-api`; same resolution rule as wrap — target is relative to `sweep/vault/`).
- `sweep/CLAUDE.md` already carries the wrap-core pointer block — no edit needed (added when sweep was scaffolded).
- `sweep/src/fs/home.ts` (or wherever sweep wants the handle to live — sweep's choice): `export const sweepFs = createAppHome({ app: "sweep" })`.
- `sweep/tests/fs-home.test.ts` — minimal acceptance: construct `createAppHome({ app: "sweep", home: tmpHome() })`, append a JSONL line via `fs.append("logs/sweep.jsonl", JSON.stringify({ ts: 1, msg: "hi" }) + "\n")`, read it back via `fs.read`, split on `\n`, `JSON.parse` the first non-empty line, assert the shape. (Sweep does not yet have a `tests/helpers.ts`; inline the `mkdtempSync` call until a second test file earns the helper.)
- `bun run check` green in all three repos.

## Acceptance

- Both wrap and sweep consume `createAppHome` from `wrap-core/fs`. No implementation of the helpers remains in wrap — `wrap/src/fs/home.ts` is a two-line `wrapFs` bind site and nothing else.
- `bun run check` is green in all three repos at every step boundary (per the atomic-commit rule in the [wrap-core handbook](../README.md)).
- Wrap's externally observable behavior is unchanged — same paths on disk, same JSONL format (still produced by wrap's own `writer.ts` on top of core's fs primitives), same on-disk effects from `$WRAP_HOME` for existing users (including empty-string falling back to `~/.wrap`). Wrap is not consumed as a library, so internal-only signature changes (dropping `home?: string` parameters) are not externally observable.
- Sweep can write a JSONL line to `~/.sweep/logs/sweep.jsonl` and read it back using only wrap-core fs APIs (verified by a test in `sweep/tests/`).
- Tests for the promoted code move with the code into `wrap-core/tests/`. Only the env-var-derivation / default-dir test is parameterized (`wrap`, `sweep`, `my-tool` — the last pins the `-` → `_` derivation); the IO suite runs once. No wrap-side duplicate.
- `wrap-core/vault/wrap-core-api/fs.md` lands; each consumer's `vault/wrap-core-api` symlink is committed.
