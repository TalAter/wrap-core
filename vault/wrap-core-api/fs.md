---
name: fs
description: App-home filesystem handle — scoped read/write/append/exists under `~/.<app>` (or `$<APP>_HOME`).
package: wrap-core/fs
---

# fs

Per-app filesystem handle. Each consumer constructs one `AppHome` at startup, scoped to its own home directory under `$HOME/.<app>` (or `$<APP>_HOME` if set). All IO is sync utf-8 text, relative to `root`. Parent directories are created on demand by `write` and `append`. Treat the returned handle as a process-wide singleton — `root` is captured at construction; if a different home is needed (tests), construct a fresh `AppHome` rather than mutating env.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `createAppHome` | `(opts: { app: string; home?: string; env?: Record<string, string \| undefined> }) => AppHome` | App identity is explicit. `app` must match `/^[a-z][a-z0-9-]*$/`; throws otherwise (even when `home` is supplied). `home`, when non-empty, must be absolute. Resolution precedence: `opts.home` → `env["<APP>_HOME"]` → `~/.<app>`; empty string at any level falls through (`||`, not `??`). |
| `AppHome.root` | `string` | Absolute path of the app-home root. Captured at construction, not lazy. Not created on disk until a write transitively `mkdir -p`s it. |
| `AppHome.resolve` | `(relPath: string) => string` | `join(root, relPath)`. No `..`-escape guarding — callers are trusted. |
| `AppHome.read` | `(relPath: string) => string \| null` | `null` for missing file; `""` for existing empty file. Non-ENOENT errors (EISDIR, EACCES, …) throw. |
| `AppHome.write` | `(relPath: string, content: string) => void` | Overwrites. Creates parent directories. |
| `AppHome.append` | `(relPath: string, content: string) => void` | Single-process append. Creates parent directories. Cross-process ordering relies on POSIX `O_APPEND`. |
| `AppHome.exists` | `(relPath: string) => boolean` | `true` for any existing file, directory, or symlink under `root`. |

## Usage

```ts
import { createAppHome } from "wrap-core/fs";
export const wrapFs = createAppHome({ app: "wrap" });
// wrapFs.read("config.json"), wrapFs.append("logs/app.jsonl", line), wrapFs.root, ...
```

## Internals

See [`wrap-core/vault/impl-specs/fs-and-log.md`](../impl-specs/fs-and-log.md) for the promotion spec (precedence rules, validation rationale, JSONL out-of-scope reasoning).
