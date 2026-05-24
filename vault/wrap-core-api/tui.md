---
name: tui
description: Ink-based TUI components, React context, hooks, and dialog mounting utilities.
package: wrap-core/tui
---

# tui

Ink component library for terminal dialogs. Ships Dialog (gradient-bordered frame), TextInput (single/multiline with emacs bindings), ActionBar (key hints), Checklist (multi-select), and Pill (badge). All components read theme from a React context provided by `ThemeProvider`.

Peer deps: `react`, `ink`, `@inkjs/ui`. Lazy-load the entire module (`await import("wrap-core/tui")`) to keep non-interactive paths fast.

## Components

| Symbol | Props (key) | Note |
| --- | --- | --- |
| `Dialog` | `gradientStops: Color[]`, `top?: TopBadge`, `bottomStatus?: string`, `naturalContentWidth: number`, `children` | Centered frame with gradient left/right borders, top badge, bottom status. `children` can be `ReactNode` or `(innerWidth: number) => ReactNode`. |
| `TextInput` | `value`, `onChange`, `onSubmit`, `placeholder?`, `masked?`, `readOnly?`, `multiline?` | Single-line or multiline. Emacs bindings (Ctrl+A/E, Meta+F/B, Ctrl+K/U/Y). Paste sanitization. 256KB buffer cap. |
| `InputFrame` | `children` | Themed background box for wrapping input content. |
| `ActionBar` | `items: ActionItem[]`, `focused?`, `dividerAfter?` | Bottom-row key hints. Items have `glyph` (hotkey text), `label`, `primary?`, `flashColor?`. |
| `Checklist` | `items: ChecklistItem[]`, `onToggle`, `onSubmit` | Multi-select with arrow navigation, Space to toggle, Enter to submit. Supports section headers. |
| `Pill` | `segs: PillSegment[]`, `nerdFonts: boolean`, `compact?` | Inline badge with optional nerd font curves. |

## Context & hooks

| Symbol | Shape | Note |
| --- | --- | --- |
| `ThemeProvider` | `({ theme: CoreThemeTokens, nerdFonts: boolean, children }) => JSX` | Wraps children with theme + nerdFonts context. Also bridges `@inkjs/ui` Select theme. Must wrap all core components. |
| `useTheme` | `() => CoreThemeTokens` | Read theme from context. Throws if outside `ThemeProvider`. |
| `useNerdFonts` | `() => boolean` | Read nerdFonts from context. Throws if outside `ThemeProvider`. |
| `useKeyBindings` | `(bindings: KeyBinding[]) => void` | First-match key dispatcher. Triggers: named keys (`"return"`, `"escape"`), single chars (`"y"`), modifier combos (`{ key: "c", ctrl: true }`). Bare char triggers block on ctrl/meta but tolerate shift. |

## Mounting utilities

| Symbol | Shape | Note |
| --- | --- | --- |
| `chooseDialogStdin` | `(deps?) => { stream: NodeJS.ReadStream; fd: number \| null }` | Picks stdin source. If stdin is a TTY, uses it directly. Otherwise opens `/dev/tty` fresh so Ink gets a real TTY for raw mode. Returns `process.stdin` as fallback in headless contexts. |
| `DIALOG_INK_OPTIONS` | `{ stdout: process.stderr, patchConsole: false, alternateScreen: true, exitOnCtrlC: false }` | Default Ink render options for dialogs. Uses stderr (stdout is for structured output). `exitOnCtrlC: false` lets key-binding layer handle Ctrl+C. |

## Other exports

| Symbol | Note |
| --- | --- |
| `dialogInnerWidth(termCols, naturalContentWidth)` | Derive inner content width for a Dialog. |
| `DIALOG_CHROME_WIDTH`, `DIALOG_CHROME_HEIGHT` | Constants for layout math (border + margin cells). |
| `matchKeyTrigger(trigger, input, key)` | Test whether a key event matches a trigger. Useful in tests. |
| `pillWidth`, `pillSegments` | Pure functions for pill layout math (used by border rendering). |
| `fitTop`, `topBorderSegments`, `bottomBorderSegments` | Border rendering functions for custom dialog chrome. |
| `formatContinuationBadge` | Format a continuation prompt badge. |

## Usage

```ts
// Lazy-load to avoid startup cost in non-interactive paths
const [ink, react, { ThemeProvider, Dialog, TextInput, ActionBar }] = await Promise.all([
  import("ink"),
  import("react"),
  import("wrap-core/tui"),
]);

const { stream: stdin, fd } = chooseDialogStdin();
const app = ink.render(
  react.createElement(ThemeProvider, { theme, nerdFonts: false, children:
    react.createElement(Dialog, { gradientStops, naturalContentWidth: 50 }, ...)
  }),
  { ...DIALOG_INK_OPTIONS, stdin },
);
// app.unmount() when done
```

## Pitfalls

- **`exitOnCtrlC: false` requires explicit handling.** `DIALOG_INK_OPTIONS` disables Ink's default Ctrl+C exit. Bind Ctrl+C to your cancel/exit handler via `useKeyBindings`, or users will be stuck.
- **Lazy-load this module.** Ink + React add ~100ms cold-start. Import dynamically in the code path that mounts a dialog, not at module top level.
- **`ThemeProvider` must wrap all core components.** `useTheme()` and `useNerdFonts()` throw if called outside the provider.
- **`chooseDialogStdin` opens a file descriptor.** When the returned `fd` is non-null, the caller owns it. Call `stream.destroy()` on unmount to close.
