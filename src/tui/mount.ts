import type { ReactElement } from "react";

/** The stdin selection returned by `chooseDialogStdin` — a stream plus the fd
 *  the caller owns (non-null when a fresh `/dev/tty` was opened). */
export type DialogStdin = { stream: NodeJS.ReadStream; fd: number | null };

/** Minimal slice of Ink's `render` we depend on. Ink is a peer dep loaded
 *  lazily by the consumer, so we accept it as an argument rather than import. */
type InkRenderer = (
  element: ReactElement,
  options?: Record<string, unknown>,
) => { rerender(element: ReactElement): void; unmount(): void };

/** Handle returned by `mount` — `rerender` swaps the tree in place, `unmount`
 *  tears it down and releases any owned stdin fd. */
export type MountedTree = {
  rerender(element: ReactElement): void;
  unmount(): void;
};

/**
 * Mount an Ink tree with the shared dialog lifecycle: render `element` onto the
 * given `ink` renderer using `inkOptions` plus the chosen `stdin.stream`, and
 * return `{ rerender, unmount }`. `unmount` tears down the Ink app and, when
 * the caller opened a fresh `/dev/tty` (`stdin.fd !== null`), destroys that
 * stream to close the descriptor.
 *
 * Pair with `chooseDialogStdin()` (whose `{ stream, fd }` plugs straight into
 * `stdin`) and `DIALOG_INK_OPTIONS` (or any Ink options object) for `inkOptions`.
 * `ink` is passed in rather than imported here because this is an internal
 * primitive: its production caller, `render-dialog.ts`, holds the lazily-
 * imported Ink module in `preloadDialogRuntime`'s cache and hands it down
 * (tests pass a fake renderer directly).
 */
export function mount(
  ink: { render: InkRenderer },
  element: ReactElement,
  opts: { inkOptions?: Record<string, unknown>; stdin: DialogStdin },
): MountedTree {
  const { stream, fd } = opts.stdin;
  const app = ink.render(element, { ...opts.inkOptions, stdin: stream });
  return {
    rerender(next) {
      app.rerender(next);
    },
    unmount() {
      app.unmount();
      if (fd !== null && typeof (stream as { destroy?: () => void }).destroy === "function") {
        (stream as { destroy: () => void }).destroy();
      }
    },
  };
}
