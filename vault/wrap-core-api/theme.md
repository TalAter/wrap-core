---
name: theme
description: Theme token types, appearance detection, reference palettes, and global theme store.
package: wrap-core/theme
---

# theme

Theme system for TUI components. Defines `CoreThemeTokens` — the color token shape that core components read — and ships dark/light reference palettes. Appearance detection probes the terminal background (OSC 11) with disk caching. Consumers extend `CoreThemeTokens` via intersection for tool-specific UI; see `vault/theme-extensibility.md`.

## Public symbols

| Symbol | Shape | Note |
| --- | --- | --- |
| `CoreThemeTokens` | `type` | Token shape for core components. Groups: `copy`, `dialog` (status + prompt only), `input`, `actionBar`, `checklist`, `picker`. Defined as `type` not `interface` — prevents declaration merging; consumers extend via intersection. |
| `Appearance` | `"dark" \| "light"` | Terminal background classification. |
| `DARK_CORE` | `CoreThemeTokens` | Reference dark palette. Consumers can spread into their own extended palette. |
| `LIGHT_CORE` | `CoreThemeTokens` | Reference light palette. |
| `setTheme` | `(theme: CoreThemeTokens) => void` | Set the process-wide active theme. Accepts extended types (structural typing). |
| `getTheme` | `() => CoreThemeTokens` | Read the active theme. Returns `DARK_CORE` if never set. |
| `resolveTheme` | `(appearance: Appearance) => CoreThemeTokens` | Map appearance to `DARK_CORE` or `LIGHT_CORE`. |
| `resolveAppearance` | `(opts: { envVarName: string; configAppearance?: "auto" \| "dark" \| "light"; fs?: AppFs }) => Promise<Appearance>` | Precedence: env var → config → disk cache → OSC 11 probe → `"dark"`. Pass `fs` for caching; omit to skip. |
| `parseOsc11Response` | `(raw: string) => Appearance \| null` | Parse an OSC 11 terminal background response. WCAG luminance threshold at 0.5. |
| `queryTerminalBackground` | `(timeoutMs?: number) => Promise<Appearance \| null>` | Probe the terminal via OSC 11. Opens `/dev/tty` independently — never touches stdin. Returns `null` on timeout or headless. |
| `getCachedAppearance` | `(fs: AppFs) => Appearance \| null` | Read cached appearance. Returns `null` if missing, expired (1 hour TTL), or malformed. |
| `cacheAppearance` | `(fs: AppFs, appearance: Appearance) => void` | Write appearance to `cache/appearance.json` under the app home. |

## Usage

```ts
import { resolveAppearance, resolveTheme, setTheme } from "wrap-core/theme";
import { sweepFs } from "./fs.ts";

const appearance = await resolveAppearance({ envVarName: "SWEEP_THEME", fs: sweepFs });
setTheme(resolveTheme(appearance));
```

### Extending for tool-specific tokens

```ts
import type { CoreThemeTokens } from "wrap-core/theme";
import { DARK_CORE } from "wrap-core/theme";

type WrapTheme = CoreThemeTokens & { wizard: { frame: FrameStops } };
const WRAP_DARK: WrapTheme = { ...DARK_CORE, wizard: { frame: [[120,180,255],[60,60,100]] } };
setTheme(WRAP_DARK); // structural typing accepts it

// Consumer wrapper hook (one line, defined once):
export const useWrapTheme = () => useTheme() as WrapTheme;
```

See `vault/theme-extensibility.md` for the full pattern.

## Pitfalls

- **`CoreThemeTokens.dialog` is trimmed.** Only `status` and `prompt`. Wrap-specific fields (`plan`, `foldIndicator`, `composePill`, etc.) live in the consumer's extended type.
- **Global store is typed as `CoreThemeTokens`.** Consumers that `setTheme(extendedTheme)` must cast when reading tool-specific fields: `getTheme() as WrapTheme`. Centralize this in one wrapper — don't scatter casts.
- **`resolveAppearance` probes the terminal.** The OSC 11 query toggles raw mode on `/dev/tty` for ~50ms. Await it before mounting Ink dialogs to avoid raw-mode races.
