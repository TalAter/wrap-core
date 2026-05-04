# wrap-core

wrap-core is shared substrate for wrap and sweep. Framework primitives only — TUI, theme, providers, dialog infra, config resolution. No tool-specific semantics. Application graphs (response schemas, concrete state graphs, voice, primary dialogs) live per-consumer.

The promotion guidelines — boundary, architecture decisions, module conventions, recipe — live in `./vault/impl-specs/wrap-core.md`.

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

When populated, two layers:
- `vault/<concept>.md` — internals. Why decisions made, deep design notes.
- `vault/wrap-core-api/<concept>.md` — usage surface for consumer tools. Symlinked into wrap's and sweep's vaults so consumer-side LLMs see them as native.

Empty until the first concept note migrates.
