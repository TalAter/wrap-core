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
| `Table` | `columns: TableColumn[]`, `rows: string[][]` | Plain aligned table: bold header row over text rows, columns sized to widest content, fixed gap between them. No borders/interactivity. `TableColumn` = `{ header, align?, color?, headerColor? }`; cell colors default to `copy.body`, headers to `copy.supporting`. Each `rows[i]` is one string per column. Render via `printInline` (it needs a `ThemeProvider`). Last left-aligned column is never right-padded, so piped output has no trailing whitespace. |

## Context & hooks

| Symbol | Shape | Note |
| --- | --- | --- |
| `ThemeProvider` | `({ theme: CoreThemeTokens, nerdFonts: boolean, children }) => JSX` | Wraps children with theme + nerdFonts context. Also bridges `@inkjs/ui` Select theme. Must wrap all core components. The dialog APIs (`renderDialog`/`openDialog`) apply this internally from their `{ theme, nerdFonts }` argument, so dialog call sites don't use it directly; exported for other render paths (e.g. inline/table renderers). |
| `useTheme` | `() => CoreThemeTokens` | Read theme from context. Throws if outside `ThemeProvider`. |
| `useNerdFonts` | `() => boolean` | Read nerdFonts from context. Throws if outside `ThemeProvider`. |
| `useKeyBindings` | `(bindings: KeyBinding[]) => void` | First-match key dispatcher. Triggers: named keys (`"return"`, `"escape"`), single chars (`"y"`), modifier combos (`{ key: "c", ctrl: true }`). Bare char triggers block on ctrl/meta but tolerate shift. |

## Inline (non-dialog) rendering

| Symbol | Shape | Note |
| --- | --- | --- |
| `printInline` | `(element, { theme, nerdFonts, stream? }) => Promise<void>` | **Inline counterpart to `renderDialog`.** Renders `element` ONCE into the terminal's normal buffer (no alt-screen) and commits it to scrollback via Ink's `<Static>` — for plain one-shot CLI output (tables, `--help`, lists), not interaction. Wraps `element` in `ThemeProvider` from the passed `{ theme, nerdFonts }` (consumers hand over plain content, same contract as the dialog APIs). Default `stream` = `process.stdout`. No stdin / no raw mode, so `tool \| grep` and `tool > file` stay safe and pipe-clean (non-TTY streams get no ANSI). Async and self-warming: warms the **shared** Ink cache on demand (`preloadDialogRuntime` not required, but a prior call makes it instant). Resolves once output has flushed and the app is torn down. |
| `PrintInlineOptions` | `{ theme: CoreThemeTokens; nerdFonts: boolean; stream?: NodeJS.WriteStream }` | Argument shape for `printInline`. |

## Mounting utilities

| Symbol | Shape | Note |
| --- | --- | --- |
| `preloadDialogRuntime` | `() => Promise<void>` | Warm Ink into the **shared** module-level cache so a later `renderDialog()` can stay synchronous. Idempotent. Call ahead of time (e.g. overlapped with a network/LLM call) to hide Ink's ~100ms cold-start. Thin public alias for the shared loader's `preloadInk()`; the same cache also serves `printInline`, so preloading once benefits both render paths. |
| `renderDialog` | `(element, { theme: CoreThemeTokens, nerdFonts: boolean }) => { rerender(next), unmount() }` | **Deep entry point for mounting a dialog.** Owns every Ink/terminal mechanic AND the theme wrap: reads preloaded Ink, picks stdin, applies `DIALOG_INK_OPTIONS` (alt-screen + stderr + `exitOnCtrlC: false`), wraps `element` in `ThemeProvider` from the passed `{ theme, nerdFonts }`, and on `unmount()` closes any owned `/dev/tty` fd. The caller passes **plain content** — the provider is internal to the dialog API. `rerender(next)` re-wraps with the theme/nerdFonts captured at mount (behavior-preserving: both are process-global, set once at startup). **Synchronous; throws if `preloadDialogRuntime()` hasn't resolved.** `unmount()` is synchronous and exits the alt-screen FIRST so callers can flush buffered output into real scrollback immediately after. |
| `openDialog` | `<T>({ theme, nerdFonts }, build: (close: (value: T) => void) => ReactElement) => Promise<T>` | **Reusable "open → await one answer → close" controller.** Sugar over `renderDialog`, not a parallel primitive: for the common prompt shape (mount a dialog, wait for one result, tear it down). Takes the same `{ theme, nerdFonts }` and forwards it to `renderDialog`, so the `ThemeProvider` wrap is handled for you — `build` returns plain content. `build` receives a `close(value)` callback — wire it to the view's submit/cancel handlers (e.g. `onSubmit: close`, `onCancel: () => close(null)`); calling it unmounts the dialog and resolves the promise. Owns ONLY the promise + unmount-on-result lifecycle. Same preload contract as `renderDialog`. For session-driven dialogs that rerender through states, use `renderDialog` directly instead. |
| `DialogTheme` | `{ theme: CoreThemeTokens; nerdFonts: boolean }` | The theme inputs both dialog APIs take. |

> `mount(ink, element, { inkOptions, stdin })`, `chooseDialogStdin(deps?)`, and `DIALOG_INK_OPTIONS` are **internal** to wrap-core — the mechanics `renderDialog` wraps, no longer exported from the barrel. Consumers use `renderDialog`/`openDialog`/`preloadDialogRuntime`. (`chooseDialogStdin`/`DIALOG_INK_OPTIONS` stay importable from `wrap-core/src/tui/dialog-host.ts` for tests.)
>
> The lazy Ink runtime lives in a **single shared module**, `wrap-core/src/tui/ink-runtime.ts`, consumed by both `render-dialog.ts` and `print-inline.ts` — one cache, one seam. It exposes `preloadInk()` (idempotent warm; `preloadDialogRuntime` is its public alias), `loadInk()` (warm-then-return, used by the async `printInline`), `getInk()` (sync accessor that throws if cold, used by the sync `renderDialog`), and the `InkRuntime` type covering both `render` and `Static`. `__setInkForTests(fake | null)` is the **single test-only** seam on that module — injects a fake Ink runtime into the shared cache so BOTH render paths can be exercised without a real terminal (pass `null` to clear). One injection is observed by both `renderDialog` and `printInline`. Production callers warm the cache via `preloadDialogRuntime()`/`printInline`'s self-warming instead. (Replaces the former separate `render-dialog.ts` `__setInkForTests` and `print-inline.ts` `__setInkForInlineTests` seams.)

## Other exports

| Symbol | Note |
| --- | --- |
| `dialogInnerWidth(termCols, naturalContentWidth)` | Derive inner content width for a Dialog. |
| `DIALOG_CHROME_WIDTH`, `DIALOG_CHROME_HEIGHT` | Constants for layout math (border + margin cells). |
| `matchKeyTrigger(trigger, input, key)` | Test whether a key event matches a trigger. Useful in tests. |
| `pillWidth`, `pillSegments` | Pure functions for pill layout math (used by border rendering). |
| `tableColumnWidths(columns, rows)`, `padCell(text, width, align?)` | Pure layout helpers behind `Table` (column sizing via `string-width`, cell padding). Exported for testing/custom table chrome. |
| `fitTop`, `topBorderSegments`, `bottomBorderSegments` | Border rendering functions for custom dialog chrome. |
| `formatContinuationBadge` | Format a continuation prompt badge. |

## Usage

```ts
// Lazy-load to avoid startup cost in non-interactive paths. Overlap
// preloadDialogRuntime() with other async work (e.g. a network call) so Ink's
// cold-start is hidden by the time you render.
const [react, { renderDialog, openDialog }] = await Promise.all([
  import("react"),
  import("wrap-core/tui").then(async (m) => {
    await m.preloadDialogRuntime(); // overlap Ink cold-start with the other imports
    return m;
  }),
]);

// Synchronous: throws if preloadDialogRuntime() hasn't resolved. Pass plain
// content + { theme, nerdFonts } — renderDialog applies ThemeProvider for you.
const app = renderDialog(
  react.createElement(Dialog, { gradientStops, naturalContentWidth: 50 }, ...),
  { theme, nerdFonts: false },
);
// app.rerender(nextElement) re-wraps with the same theme; app.unmount() when done.

// Or, for the open-await-one-answer-close shape:
const result = await openDialog({ theme, nerdFonts: false }, (close) =>
  react.createElement(MyDialog, { onSubmit: close, onCancel: () => close(null) }),
);
```

## Pitfalls

- **`renderDialog` must be preloaded, else it throws.** It's synchronous by design (so callers don't have to thread an `await` through their mount logic); call `preloadDialogRuntime()` first — ideally overlapped with other async work.
- **`unmount()` is synchronous and tears down the alt-screen FIRST.** Callers (e.g. wrap's notification router) flush buffered output immediately after `unmount()` returns, relying on it landing in the real scrollback rather than the about-to-vanish alt buffer. Never make `unmount()` async or add a post-unmount flush.
- **`exitOnCtrlC: false` requires explicit handling.** All dialogs render with `exitOnCtrlC: false`. Bind Ctrl+C to your cancel/exit handler via `useKeyBindings`, or users will be stuck.
- **`ThemeProvider` is applied by the dialog APIs.** `useTheme()`/`useNerdFonts()` throw outside a provider, but `renderDialog`/`openDialog` add it from the `{ theme, nerdFonts }` you pass — dialog call sites hand over plain content. Use `ThemeProvider` directly only for non-dialog render paths.
- **fd ownership is internal.** `renderDialog` owns the `/dev/tty` descriptor it may open and closes it on `unmount()`. The stdin picker (`chooseDialogStdin`) and `DIALOG_INK_OPTIONS` are internal to wrap-core (importable from `wrap-core/src/tui/dialog-host.ts` for tests).
