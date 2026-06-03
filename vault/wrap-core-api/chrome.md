---
name: chrome
description: Leaf stderr "chrome" output primitives — status-line writer, raw byte writer, and the out-of-Ink chrome spinner with exit-guard teardown.
package: wrap-core/chrome
---

# chrome

Lowest-layer narration output. "Chrome" is the human-facing channel — status lines, spinner, ANSI escapes — that renders to stderr, kept separate from the command's product on stdout. These are leaf primitives only: no notification bus, no router, no config. Consumers (wrap's notify bus, sweep) layer their own interception/policy on top and delegate the actual byte writes here.

Depends only on `wrap-core/ansi` escapes (`HIDE_CURSOR`, `SHOW_CURSOR`, `ERASE_LINE`) and `process.stderr`.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `writeChromeLine` | `(text: string, icon?: string, stream?: WritableStream) => void` | Format a chrome line (`${icon} ${text}\n`, or `${text}\n` with no icon) and write it. `stream` defaults to `process.stderr`. Trailing newline always appended. |
| `chromeRaw` | `(msg: string, stream?: WritableStream) => void` | Raw write, no trailing newline. For ANSI escapes / partial writes (used by the spinner). `stream` defaults to `process.stderr`. |
| `startChromeSpinner` | `(text: string, opts?: { noAnimation?: boolean }) => () => void` | Stderr spinner used outside Ink. Hides the cursor, overwrites a single line in place each tick. Returns an idempotent `stop` that clears the line + restores the cursor. No-op when stderr is not a TTY. With `noAnimation`, shows `text` once (no frame/cursor-hide/interval) and erases on stop — caller owns the policy of when to disable animation. |
| `registerExitTeardown` | `(bytes: string) => () => void` | Register a byte string to write to stderr on process `exit`/`SIGINT`/`SIGTERM`. Returns an unregister fn. Listeners install lazily on first call; SIGINT/SIGTERM restore then re-exit with code 130/143. Used to guarantee terminal-mode restoration (cursor show, kitty mode pop) on abnormal exit. |
| `resetExitGuard` | `() => void` | Test-only. Clears the install flag, registered teardowns, and the cursor-teardown singleton. |
| `_resetExitTeardownRegistryForTests` | `() => void` | Test-only alias for `resetExitGuard`. |
| `SPINNER_FRAMES` | `string[]` | Two-cell braille frames, all equal visual width so they sit in a fixed slot. |
| `SPINNER_INTERVAL` | `number` | Tick interval in ms (80). |
| `SPINNER_TEXT` | `string` | Default spinner label (`"thinking..."`). |

## Usage

```ts
import { startChromeSpinner, writeChromeLine, chromeRaw } from "wrap-core/chrome";

writeChromeLine("Done.", "✓");        // "✓ Done.\n" → stderr
const stop = startChromeSpinner("thinking...", { noAnimation: false });
// ... await work ...
stop();                                // clears the line, restores the cursor
```

## Pitfalls

- **`startChromeSpinner` is TTY-gated on stderr.** When `process.stderr.isTTY` is false it returns a no-op `stop` and writes nothing, so `\r`/escape garbage never lands in redirected logs.
- **`noAnimation` policy lives in the caller.** The spinner takes a plain boolean — it does not read env/config. wrap injects `getConfig().noAnimation`; other consumers fold their own CI/NO_COLOR/flag logic.
- **Exit guards install lazily and once.** The first `registerExitTeardown` (including the spinner's internal cursor-show registration) installs the process listeners. Use `resetExitGuard()` between tests to re-arm the install with a mocked `process.on`.
- **`stop` is idempotent.** Safe to call from both a catch block and a surrounding finally — the second call is a no-op.
