# wrap-core

wrap-core is shared substrate for wrap and sweep. Framework primitives only — TUI, theme, providers, dialog infra, config resolution. No tool-specific semantics. Application graphs (response schemas, concrete state graphs, voice, primary dialogs) live per-consumer.

Deeper context — boundary, decisions, module conventions: [`vault/README.md`](./vault/README.md).

## Promotion

- **Refactor, not a rename.** Each promotion reshapes the wrap module into pure framework code — wrap-specific deps lifted to parameters. Core ends up cleaner than the original.
- **Demand-pulled by sweep.** No migration project, no schedule. Promote when sweep needs something wrap already has.
- **Atomic across all three repos.** Each commit leaves wrap, wrap-core, and sweep passing `bun run check`. Both consumers wired in the same promotion.
- **Repos:** `~/mysite/{wrap,wrap-core,sweep}/`, linked via `bun link`.

## Stack

- **Runtime:** Bun (TypeScript 5 — version 6 not supported). Use `bun add` / `bun add -D` for dependencies. Never npm or pnpm.
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
