import type { ReactElement } from "react";

/** Ink's `<Static>` as wrap-core uses it: a list of items rendered once via a
 *  child render function. (Only `print-inline` needs `Static`.) */
type StaticComponent = (props: {
  items: ReactElement[];
  children: (item: ReactElement, index: number) => ReactElement;
}) => ReactElement;

/**
 * The slice of the Ink runtime wrap-core depends on, covering BOTH render paths:
 * `render` (dialogs + inline) plus the `Static` component (inline only). One
 * shape so a single cache and test seam serve both consumers.
 */
export type InkRuntime = {
  Static: StaticComponent;
  render: (
    element: ReactElement,
    options?: Record<string, unknown>,
  ) => { rerender(element: ReactElement): void; unmount(): void };
};

/** The single module-level cache for the lazily-imported Ink runtime, shared by
 *  `render-dialog` (sync, preload-or-throw) and `print-inline` (async, self-
 *  warming). Warmed by `preloadInk()`/`loadInk()` or injected in tests. */
let inkCached: InkRuntime | null = null;

/**
 * Test-only seam: inject a fake Ink runtime in place of the real cached module
 * so both the dialog and inline mount paths can be exercised without a real
 * terminal. Pass `null` to clear. Production callers warm the cache via
 * `preloadInk()`/`loadInk()` instead.
 */
export function __setInkForTests(fake: InkRuntime | null): void {
  inkCached = fake;
}

/**
 * Warm Ink into the shared cache. Ink (+ its React/Yoga graph) adds ~100ms of
 * cold-start; call ahead of time (e.g. overlapped with a network call) so a
 * later sync `getInk()` is instant. Idempotent.
 */
export async function preloadInk(): Promise<void> {
  if (inkCached) return;
  inkCached = (await import("ink")) as unknown as InkRuntime;
}

/**
 * Warm-then-return the Ink runtime. For the async, self-warming caller
 * (`printInline`): imports Ink on demand if the cache is cold, so callers need
 * no preload contract.
 */
export async function loadInk(): Promise<InkRuntime> {
  if (!inkCached) await preloadInk();
  return inkCached as InkRuntime;
}

/**
 * Return the cached Ink runtime synchronously, or throw if it's cold. For the
 * sync caller (`renderDialog`): the preload-or-throw contract its consumers
 * rely on. Warm the cache with `preloadInk()` (aka `preloadDialogRuntime`) first.
 */
export function getInk(): InkRuntime {
  if (!inkCached) {
    throw new Error("renderDialog: preloadDialogRuntime() must resolve first");
  }
  return inkCached;
}
