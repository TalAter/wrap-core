import { createElement, type ReactElement } from "react";
import type { CoreThemeTokens } from "../theme/index.ts";
import { chooseDialogStdin, DIALOG_INK_OPTIONS } from "./dialog-host.ts";
import { getInk, preloadInk } from "./ink-runtime.ts";
import { type MountedTree, mount } from "./mount.ts";
import { ThemeProvider } from "./theme-context.tsx";

/**
 * Warm Ink into the shared cache so a later `renderDialog()` can stay
 * synchronous. Thin public alias for the shared loader's `preloadInk()`; Ink
 * (+ its React/Yoga graph) adds ~100ms of cold-start, so call this ahead of
 * time (e.g. overlapped with a network call) to hide it. Idempotent.
 */
export const preloadDialogRuntime = preloadInk;

/** Theme inputs every dialog needs: the active token set plus whether the
 *  terminal renders nerd-font glyphs. `renderDialog`/`openDialog` own the
 *  `ThemeProvider` wrap internally, so consumers pass these instead of
 *  hand-wrapping their content. */
export type DialogTheme = { theme: CoreThemeTokens; nerdFonts: boolean };

/** Handle returned by `renderDialog` — `rerender` swaps the tree in place,
 *  `unmount` tears it down and releases any owned `/dev/tty` descriptor. */
export type RenderedDialog = {
  rerender(nextElement: ReactElement): void;
  unmount(): void;
};

/**
 * Render `element` as a dialog: Ink alt-screen on stderr, keystrokes from the
 * best available tty (see `chooseDialogStdin`), Ctrl+C left to the element's
 * own bindings (`exitOnCtrlC: false`). The consumer passes plain content plus
 * `{ theme, nerdFonts }`; wrap-core wraps it in `ThemeProvider` and owns every
 * terminal/Ink mechanic, so call sites never touch the provider themselves.
 *
 * `rerender(next)` re-wraps `next` in `ThemeProvider` using the theme/nerdFonts
 * captured at mount. This is behavior-preserving: theme/nerdFonts are process-
 * global (set once at startup via `setTheme`/config), so capturing at mount
 * equals re-reading per rerender.
 *
 * SYNCHRONOUS by contract: `preloadDialogRuntime()` must have resolved first,
 * otherwise this throws. (Mirrors the preload-or-throw contract the dialog
 * consumers already rely on.)
 *
 * HARD INVARIANT: `unmount()` is synchronous and tears down the alt-screen
 * FIRST (Ink's `unmount()` exits the alternate buffer before we touch the fd).
 * Callers flush buffered output immediately after `unmount()` returns and rely
 * on that output landing in the real scrollback, not the about-to-vanish alt
 * buffer. Do NOT make `unmount()` async or add any post-unmount flush here.
 */
export function renderDialog(element: ReactElement, opts: DialogTheme): RenderedDialog {
  const ink = getInk();
  const { theme, nerdFonts } = opts;
  const wrap = (content: ReactElement) =>
    // biome-ignore lint/correctness/noChildrenProp: ThemeProvider types children as a required prop
    createElement(ThemeProvider, { theme, nerdFonts, children: content });
  const tree: MountedTree = mount(ink, wrap(element), {
    inkOptions: DIALOG_INK_OPTIONS,
    stdin: chooseDialogStdin(),
  });
  return {
    rerender(nextElement) {
      tree.rerender(wrap(nextElement));
    },
    unmount() {
      // Alt-screen teardown happens synchronously inside tree.unmount().
      tree.unmount();
    },
  };
}

/**
 * "Open → await one answer → close" controller built on `renderDialog`. Sugar
 * for the common prompt shape: mount a dialog, wait for the user to produce a
 * single result, tear it down. `build` receives a `close(value)` callback —
 * wire it to the view's submit/cancel handlers; calling it unmounts the dialog
 * and resolves the promise with `value`.
 *
 * Owns ONLY the promise + unmount-on-result lifecycle. The `ThemeProvider` wrap
 * is handled by the underlying `renderDialog` from the passed `{ theme,
 * nerdFonts }`, so `build` returns plain content. Same preload contract as
 * `renderDialog`: `preloadDialogRuntime()` must have resolved first, otherwise
 * the inner `renderDialog` throws.
 *
 * Argument order: `openDialog(opts, build)` — the `{ theme, nerdFonts }` opts
 * come first, then the builder callback.
 */
export function openDialog<T>(
  opts: DialogTheme,
  build: (close: (value: T) => void) => ReactElement,
): Promise<T> {
  return new Promise<T>((resolve) => {
    let app: RenderedDialog;
    const close = (value: T) => {
      app.unmount();
      resolve(value);
    };
    app = renderDialog(build(close), opts);
  });
}
