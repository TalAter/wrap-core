---
name: fs-and-log
description: First promotion to wrap-core — app-home filesystem helpers and append-only JSONL logging — pulled by sweep v0.
---

# fs-and-log

First concrete promotion from wrap into wrap-core. Triggered by sweep v0, which needs the same filesystem + logging substrate wrap already uses.

## Why now

Sweep is starting from scratch. Its v0 has two persistence needs that mirror wrap's exactly:

1. A local store under `~/.sweep/` (with env location override) for config, fetched scripts and logs.
2. An append-only JSONL log — every `sweep "..."` invocation records one entry.

Both capabilities already exist in wrap, but hardcoded to wrap's identity. Promoting them now means sweep doesn't fork-and-diverge from day one, and forces the first generic-ization through wrap-core.

## Use cases driving the interface

**Sweep v0** persists three distinct things under `~/.sweep/`:

- `scripts/<sha256>` — fetched install scripts, deduped by content hash. Uses the filesystem capability directly.
- `installed.json` (exact name/shape TBD) — the authoritative registry of currently-installed tools. Source of truth for `sweep list`, and later `sweep away` and `sweep update`. Read-modify-write on top of the filesystem capability — **sweep-side code, not part of this promotion**.
- `logs/sweep.jsonl` — append-only history of every encounter (fetch attempt + exec attempt + outcome). Used for forensics and change tracking. Safely trimmable without breaking `sweep list`.

The registry and the encounter log are deliberately separate concerns: logs can be rotated or deleted without losing the user's installed-tools state.

**Wrap currently** persists to `~/.wrap/logs/wrap.jsonl` (+ trace sidecars) and reads via `lookup.ts`. After the promotion, wrap behaves identically — same paths, same on-disk format, same error semantics — but through wrap-core.

## Capability 1: app-home filesystem

Each consumer has its own home directory under `$HOME/.<app>` (default) or `$<APP>_HOME` (env override). Inside that home, consumers need to:

- Resolve any path *under* home.
- Read a file; missing returns absent (not throw).
- Write or append text; parent directories created on demand.
- Check existence.

App identity should be explicit at the API surface — wrap-core has no hardcoded knowledge of `wrap` or `sweep`. Consumers should also be able to thread a custom home path through, primarily for tests.

Current wrap impl (`wrap/src/fs/home.ts`) is the starting point. Its current callers across wrap migrate to the generic surface as part of the same promotion commit.

## Capability 2: append-only JSONL log

A thin layer over Capability 1. Consumers need to:

- **Append** one entry per call to a JSONL file under their home. Each entry is the consumer's own typed shape — wrap-core does not define what's inside an entry.
- **Iterate** entries back from the file (full pass; no incremental cursor needed yet).
- Survive partial-write failure cleanly: the JSONL row is the durable record. If a consumer also wants to write richer payloads alongside (wrap's trace sidecars), those go *after* the line is appended and their failure must not undo the row.

What stays per-tool: the **entry shape itself**. Wrap's `LogEntry` (turns + LLM attempt traces) and sweep's encounter record (URL, hash, env, shell, args, sudo flag, exit code, timestamps) live in their own repos. wrap-core knows "append a row" and "iterate rows," not what fields a row carries.

## Acceptance

- Both wrap and sweep import these primitives from `wrap-core`. No duplicate copies remain in wrap.
- `bun run check` is green in all three repos at the promotion commit (per the atomic-commit rule in [wrap-core.md](./wrap-core.md)).
- Wrap's externally observable behavior is unchanged — same paths on disk, same JSONL format, same error semantics for existing callers.
- Sweep can write a JSONL entry to `~/.sweep/logs/sweep.jsonl` and read it back using only wrap-core APIs (verified by a test in sweep).
- Tests for the promoted code move with the code; an api note lands under `vault/wrap-core-api/` so consumer-side LLMs see the surface.
