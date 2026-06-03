import { createElement, Fragment, type ReactElement } from "react";
import type { CoreThemeTokens } from "../theme/index.ts";
import { ThemeProvider } from "./theme-context.tsx";

/** Ink's `<Static>` as we use it: a list of items rendered once via a child
 *  render function. */
type StaticComponent = (props: {
  items: ReactElement[];
  children: (item: ReactElement, index: number) => ReactElement;
}) => ReactElement;

/** Minimal slice of the Ink runtime `printInline` depends on: the `render`
 *  entry point plus the `Static` component it commits output through. */
type InkInline = {
  Static: StaticComponent;
  render: (
    element: ReactElement,
    options?: Record<string, unknown>,
  ) => { rerender(element: ReactElement): void; unmount(): void };
};

/** Module-level cache for the lazily-imported Ink runtime. Unlike the dialog
 *  path, `printInline` is async and imports Ink on demand, so there is no
 *  preload-or-throw contract. */
let inkCached: InkInline | null = null;

/** Test-only seam: inject a fake Ink renderer so the inline mount path can be
 *  exercised without a real terminal. Pass `null` to clear. */
export function __setInkForInlineTests(fake: InkInline | null): void {
  inkCached = fake;
}

export type PrintInlineOptions = {
  theme: CoreThemeTokens;
  nerdFonts: boolean;
  /** Destination stream. Defaults to `process.stdout`. */
  stream?: NodeJS.WriteStream;
};

/**
 * Render `element` ONCE into the terminal's normal buffer (no alternate screen)
 * and commit it permanently to scrollback. The inline counterpart to
 * `renderDialog`: where dialogs take over an alt-screen for interaction, this is
 * for plain one-shot CLI output (tables, `--help`, lists).
 *
 * The element is wrapped in Ink's `<Static>` so it writes directly above the
 * (empty) live region — handling output taller than the viewport and piping
 * (`tool | less`, `tool > file`) without truncation. Like the dialog APIs, this
 * owns the `ThemeProvider` wrap from the passed `{ theme, nerdFonts }`, so
 * callers hand over plain content.
 *
 * No stdin is read and raw mode is never enabled, so `tool | grep` stays safe.
 * Resolves once the output has flushed and the Ink app is torn down.
 */
export async function printInline(element: ReactElement, opts: PrintInlineOptions): Promise<void> {
  if (!inkCached) inkCached = (await import("ink")) as unknown as InkInline;
  const ink = inkCached;
  const stream = opts.stream ?? process.stdout;

  const content = createElement(ink.Static, {
    items: [element],
    // biome-ignore lint/correctness/noChildrenProp: <Static> takes its item renderer as a children render-prop
    children: (item: ReactElement, index: number) => createElement(Fragment, { key: index }, item),
  });
  const wrapped = createElement(ThemeProvider, {
    theme: opts.theme,
    nerdFonts: opts.nerdFonts,
    // biome-ignore lint/correctness/noChildrenProp: ThemeProvider types children as a required prop
    children: content,
  });

  const app = ink.render(wrapped, { stdout: stream, patchConsole: false, exitOnCtrlC: false });
  // `<Static>` commits to scrollback on Ink's leading (synchronous) render; wait
  // one tick so any trailing throttled flush lands, then tear down. The live
  // region is empty, so unmount leaves the committed output untouched.
  await new Promise<void>((resolve) => setImmediate(resolve));
  app.unmount();
}
