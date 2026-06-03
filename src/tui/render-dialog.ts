import type { ReactElement } from "react";
import { chooseDialogStdin, DIALOG_INK_OPTIONS } from "./dialog-host.ts";
import { type MountedTree, mount } from "./mount.ts";

/** Module-level cache for the lazily-imported Ink runtime. Warmed by
 *  `preloadDialogRuntime()` so `renderDialog()` can stay synchronous. */
let inkCached: typeof import("ink") | null = null;

/**
 * Warm Ink into a module-level cache. Ink (+ its React/Yoga graph) adds ~100ms
 * of cold-start; call this ahead of time (e.g. overlapped with a network call)
 * so the later `renderDialog()` mount is instant. Idempotent.
 */
export async function preloadDialogRuntime(): Promise<void> {
  if (inkCached) return;
  inkCached = await import("ink");
}

/** Handle returned by `renderDialog` — `rerender` swaps the tree in place,
 *  `unmount` tears it down and releases any owned `/dev/tty` descriptor. */
export type RenderedDialog = {
  rerender(nextElement: ReactElement): void;
  unmount(): void;
};

/**
 * Render `element` as a dialog: Ink alt-screen on stderr, keystrokes from the
 * best available tty (see `chooseDialogStdin`), Ctrl+C left to the element's
 * own bindings (`exitOnCtrlC: false`). The consumer hands over a fully
 * theme-wrapped React element; wrap-core owns every terminal/Ink mechanic.
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
export function renderDialog(element: ReactElement): RenderedDialog {
  if (!inkCached) {
    throw new Error("renderDialog: preloadDialogRuntime() must resolve first");
  }
  const tree: MountedTree = mount(inkCached, element, {
    inkOptions: DIALOG_INK_OPTIONS,
    stdin: chooseDialogStdin(),
  });
  return {
    rerender(nextElement) {
      tree.rerender(nextElement);
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
 * Owns ONLY the promise + unmount-on-result lifecycle. It does NOT wrap the
 * element in `ThemeProvider` — `build` must return a fully theme-wrapped
 * element. Same preload contract as `renderDialog`: `preloadDialogRuntime()`
 * must have resolved first, otherwise the inner `renderDialog` throws.
 */
export function openDialog<T>(build: (close: (value: T) => void) => ReactElement): Promise<T> {
  return new Promise<T>((resolve) => {
    let app: RenderedDialog;
    const close = (value: T) => {
      app.unmount();
      resolve(value);
    };
    app = renderDialog(build(close));
  });
}
