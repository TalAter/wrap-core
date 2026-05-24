---
name: ansi
description: Color math, ANSI escape helpers, terminal capability detection, and ColorRef resolution.
package: wrap-core/ansi
---

# ansi

Color primitives and terminal capability detection. Zero external dependencies. Provides RGB color math (OKLAB perceptually-uniform interpolation), ANSI escape sequence helpers, terminal color-level detection, and `ColorRef` resolution — the bridge between theme tokens and concrete terminal colors.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `Color` | `[number, number, number]` | RGB tuple. Used everywhere colors appear. |
| `ColorRef` | `Color \| { base: Color; ansi16?: Color; ansi256?: Color }` | Color with optional overrides for limited palettes. Theme tokens are `ColorRef` values. |
| `TokenPair` | `{ fg: ColorRef; bg: ColorRef }` | Foreground + background pair (badges, pills). |
| `BadgeColors` | `TokenPair` | Alias for semantic clarity. |
| `FrameStops` | `[Color, Color]` | Two-stop gradient for dialog borders. |
| `ColorLevel` | `0 \| 1 \| 2 \| 3` | 0 = none, 1 = 16-color, 2 = 256-color, 3 = truecolor. |
| `ANSI16` | `Record<string, Color>` | xterm-16 palette constants (`black` through `brightWhite`). Terminals remap via the user's palette, so use as an `ansi16` override to pin to a slot. |
| `colorLevel` | `() => ColorLevel` | Cached detection: `NO_COLOR` → `FORCE_COLOR` → TTY check → `COLORTERM` → terminal env vars → `TERM` → fallback 2. |
| `isTTY` | `() => boolean` | `process.stdout.isTTY`. |
| `supportsColor` | `() => boolean` | `false` if `NO_COLOR` set; `true` if `FORCE_COLOR` set (non-zero); else `isTTY()`. |
| `resolveColorHex` | `(c: ColorRef) => string` | Resolve a `ColorRef` to a `#rrggbb` hex string, pre-quantized for the current `colorLevel()`. Use for Ink color props. |
| `resolveColor` | `(c: ColorRef, level?: number) => Color` | Pick the RGB tuple for the given level — override if matching, else base. |
| `colorHex` | `(c: Color) => string` | Raw RGB → `#rrggbb`. No quantization. |
| `quantizeColor` | `(c: Color, level: number) => Color` | Snap a color to the nearest representable RGB for the given level. |
| `fgCode` | `(r, g, b, level?) => string` | SGR foreground escape for the given color at the given level. |
| `interpolate` | `(stops: readonly Color[], t: number) => Color` | Blend between color stops in OKLAB space. `t` in [0, 1]. |
| `gradientCells` | `(text, stops, shinePos?, shineRadius?, level?) => string[]` | Per-cell gradient rendering. Each element is a styled character or plain space. |
| `gradient` | `(text, stops, shinePos?, shineRadius?, level?) => string` | Single-string gradient with trailing reset. |
| `bold` | `(text: string) => string` | Wrap in bold escape. |
| `dim` | `(text: string) => string` | Wrap in dim escape. |
| `fg` | `(text: string, r, g, b) => string` | Wrap in truecolor foreground. |
| `stripAnsi` | `(text: string) => string` | Remove ANSI SGR escapes. |
| `SHOW_CURSOR` | `string` | `ESC[?25h` |
| `HIDE_CURSOR` | `string` | `ESC[?25l` |
| `ERASE_LINE` | `string` | `ESC[2K` |

## Usage

```ts
import { colorLevel, resolveColorHex, type ColorRef, ANSI16 } from "wrap-core/ansi";

const ref: ColorRef = { base: [120, 230, 160], ansi16: ANSI16.green };
const hex = resolveColorHex(ref); // "#78e6a0" at level 3, "#00aa00" at level 1
```

## Pitfalls

- **`colorLevel()` is cached.** First call reads env/TTY and caches. Subsequent calls return the cached value even if env changes. Use `__resetColorLevelCache()` in tests.
- **`resolveColorHex` reads `colorLevel()` internally.** Callers don't pass a level — it's auto-detected. If you need a specific level, use `resolveColor(c, level)` + `colorHex(quantizeColor(result, level))`.
- **`isTTY()` checks stdout, not stdin.** For stdin TTY status, check `process.stdin.isTTY` directly.
