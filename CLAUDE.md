# wrap-core

wrap-core is shared substrate for wrap and sweep. Framework primitives only — TUI, theme, providers, dialog infra, config resolution. No tool-specific semantics. Application graphs (response schemas, concrete state graphs, voice, primary dialogs) live per-consumer.

Deeper context — boundary, decisions, module conventions: [`vault/README.md`](./vault/README.md).

## Deep modules, not helpers

Every core module is a **deep abstraction**: a small, intent-revealing interface
hiding a lot of machinery. Consumers ask for *what* they want, not *how* it
happens — `openDialog()`, not `mount()`/`unmount()`/`parseSSE()`.

**The dividing line is the same at every layer: core owns the *mechanics*;
consumers own the *content* and the *domain predicates*.**

- **Mechanics** = how a thing is shaped, sent, retried, streamed, parsed, cached,
  laid out, or measured; how state accumulates; which provider, transport, or
  terminal backend is used. Always core.
- **Content** = schemas, prompt text, palettes, voice, examples, settings keys —
  the *what*. Inert values, passed in as parameters at construction. Always
  consumer.
- **Domain predicates** = "is this LLM response acceptable?", "does this config
  value validate?" — the small decision functions only the consumer can answer.
  Callbacks core invokes while running its loop. Always consumer.

**Flexibility.** This is a guideline, not a hill to die on. Surface a sliver of
internals when it genuinely earns its place — eg `preloadDialogRuntime()` exposes
mechanics but simplifies callers. Prefer depth; allow the pragmatic
exception, and record why — in the promotion's `vault/<concept>.md` note, or a
comment at the exposed surface.

## Promotion

- **Refactor, not a rename.** Each promotion reshapes the wrap module into pure framework code — wrap-specific deps lifted to parameters. Core ends up cleaner than the original.
- **Demand-pulled by sweep.** No migration project, no schedule. Promote when sweep needs something wrap already has.
- **Atomic across all three repos.** Each commit leaves wrap, wrap-core, and sweep passing `bun run check`. Both consumers wired in the same promotion.
- **Repos:** wrap, wrap-core, and sweep are separate repos. Consumers depend on published semver versions of wrap-core.

## Stack

- **Runtime:** Bun (TypeScript 5 — version 6 not supported). Use `bun add` / `bun add -D` for dependencies. Never npm or pnpm.
- **Setup:** `bun run setup` installs this repo's deps. For local cross-repo development, use a Bun workspace outside this repo rather than `bun link`.
- **Lint/format:** Biome + tsc (`bun run lint` = biome --write + typecheck).
- **Test:** `bun run test` (files in `tests/`). Run specific tests with `bun test tests/foo.test.ts`.
- **Full check:** `bun run check` = lint + test.

## Hard rules

- **Pure framework code.** No tool-specific semantics in core (wrap and sweep are sample tools). Schemas, voice text, palettes, settings keys — all passed in as parameters at construction.
- **Public surface is `src/<module>/index.ts`.** Only paths listed in `package.json` `exports` are importable. Sibling files inside a module are private.
- **Intra-core imports use relative paths.** `../theme/index.ts`, not `wrap-core/theme`.
- **No build step.** Source TS ships directly; consumers compile with their own setup.

## Testing — TDD

All implementation follows TDD. Failing test first. No exceptions. Aim for high test coverage, but tests must earn their place — skip those that only prove plumbing.

## Vault

- `vault/README.md` — handbook: philosophy, boundary, module conventions.
- `vault/impl-specs/<promotion>.md` — per-promotion build specs.
- `vault/<concept>.md` — internals from individual promotions (why decisions, deep design notes).
- `vault/wrap-core-api/<concept>.md` — usage surface for consumer tools. Symlinked into wrap's and sweep's vaults so consumer-side LLMs see them as native.
- `vault/dependency-model.md` — how wrap-core actually resolves today (local workspace linking vs. a separate CI-only mechanism), vs. the published-semver end state described above. Read before touching dependency wiring, build scripts, or release workflows in any consumer. Also symlinked into wrap's and sweep's vaults.
