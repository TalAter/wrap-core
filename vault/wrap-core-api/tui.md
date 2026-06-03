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
| `preloadDialogRuntime` | `() => Promise<void>` | Warm Ink into a module-level cache so a later `renderDialog()` can stay synchronous. Idempotent. Call ahead of time (e.g. overlapped with a network/LLM call) to hide Ink's ~100ms cold-start. |
| `renderDialog` | `(element) => { rerender(next), unmount() }` | **Deep entry point for mounting a dialog.** Owns every Ink/terminal mechanic: reads preloaded Ink, picks stdin (`chooseDialogStdin`), applies `DIALOG_INK_OPTIONS` (alt-screen + stderr + `exitOnCtrlC: false`), and on `unmount()` closes any owned `/dev/tty` fd. The caller passes only a fully `ThemeProvider`-wrapped React element — theme resolution stays per-tool. **Synchronous; throws if `preloadDialogRuntime()` hasn't resolved.** `unmount()` is synchronous and exits the alt-screen FIRST so callers can flush buffered output into real scrollback immediately after. |
| `openDialog` | `<T>(build: (close: (value: T) => void) => ReactElement) => Promise<T>` | **Reusable "open → await one answer → close" controller.** Sugar over `renderDialog`, not a parallel primitive: for the common prompt shape (mount a dialog, wait for one result, tear it down). `build` receives a `close(value)` callback — wire it to the view's submit/cancel handlers (e.g. `onSubmit: close`, `onCancel: () => close(null)`); calling it unmounts the dialog and resolves the promise. Owns ONLY the promise + unmount-on-result lifecycle; does NOT wrap in `ThemeProvider`, so `build` must return a fully theme-wrapped element. Same preload contract as `renderDialog` (throws via the inner `renderDialog` if `preloadDialogRuntime()` hasn't resolved). For session-driven dialogs that rerender through states, use `renderDialog` directly instead. |
| `chooseDialogStdin` | `(deps?) => { stream: NodeJS.ReadStream; fd: number \| null }` | Picks stdin source. If stdin is a TTY, uses it directly. Otherwise opens `/dev/tty` fresh so Ink gets a real TTY for raw mode. Returns `process.stdin` as fallback in headless contexts. Used internally by `renderDialog`; exported for tests/advanced use. |
| `DIALOG_INK_OPTIONS` | `{ stdout: process.stderr, patchConsole: false, alternateScreen: true, exitOnCtrlC: false }` | Default Ink render options for dialogs (applied internally by `renderDialog`). Uses stderr (stdout is for structured output). `exitOnCtrlC: false` lets the key-binding layer handle Ctrl+C. |

> `mount(ink, element, { inkOptions, stdin })` is now **internal** to wrap-core — it's the shallow primitive `renderDialog` wraps and is no longer exported. Consumers should use `renderDialog`/`preloadDialogRuntime`.

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
// Lazy-load to avoid startup cost in non-interactive paths. Overlap
// preloadDialogRuntime() with other async work (e.g. a network call) so Ink's
// cold-start is hidden by the time you render.
const [react, { ThemeProvider, Dialog }] = await Promise.all([
  import("react"),
  import("wrap-core/tui"),
  preloadDialogRuntime(),
]);

// Synchronous: throws if preloadDialogRuntime() hasn't resolved. The element
// must already be ThemeProvider-wrapped (theme resolution is per-tool).
const app = renderDialog(
  react.createElement(ThemeProvider, {
    theme,
    nerdFonts: false,
    children: react.createElement(Dialog, { gradientStops, naturalContentWidth: 50 }, ...),
  }),
);
// app.rerender(nextElement) to swap the tree; app.unmount() when done.
```

## Pitfalls

- **`renderDialog` must be preloaded, else it throws.** It's synchronous by design (so callers don't have to thread an `await` through their mount logic); call `preloadDialogRuntime()` first — ideally overlapped with other async work.
- **`unmount()` is synchronous and tears down the alt-screen FIRST.** Callers (e.g. wrap's notification router) flush buffered output immediately after `unmount()` returns, relying on it landing in the real scrollback rather than the about-to-vanish alt buffer. Never make `unmount()` async or add a post-unmount flush.
- **`exitOnCtrlC: false` requires explicit handling.** All dialogs render with `exitOnCtrlC: false`. Bind Ctrl+C to your cancel/exit handler via `useKeyBindings`, or users will be stuck.
- **`ThemeProvider` must wrap all core components.** `useTheme()` and `useNerdFonts()` throw if called outside the provider. `renderDialog` does NOT add it — pass an already-wrapped element so theme resolution stays per-tool.
- **fd ownership is internal now.** `renderDialog` owns the `/dev/tty` descriptor `chooseDialogStdin` may open and closes it on `unmount()`. Only manage the fd yourself if you call `chooseDialogStdin` directly.
