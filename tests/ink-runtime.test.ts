import { afterEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { DARK_CORE } from "../src/theme/index.ts";
import { __setInkForTests } from "../src/tui/ink-runtime.ts";
import { printInline } from "../src/tui/print-inline.ts";
import { renderDialog } from "../src/tui/render-dialog.ts";

/** A sentinel standing in for Ink's `<Static>` component. */
function FakeStatic(): ReactElement {
  return createElement("fake-static");
}

/** Fake Ink runtime (render + Static) recording how it's used by both paths. */
function fakeInk() {
  const calls = { rendered: 0, unmounted: 0 };
  const ink = {
    Static: FakeStatic,
    render() {
      calls.rendered += 1;
      return {
        rerender() {},
        unmount() {
          calls.unmounted += 1;
        },
      };
    },
  } as unknown as Parameters<typeof __setInkForTests>[0];
  return { ink, calls };
}

const content = createElement("content");

afterEach(() => {
  __setInkForTests(null);
});

describe("ink-runtime shared cache", () => {
  test("one injected fake is observed by BOTH renderDialog (sync) and printInline (async)", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);

    // Sync dialog path uses the injected fake (does not throw → cache is warm).
    const app = renderDialog(content, { theme: DARK_CORE, nerdFonts: false });
    app.unmount();

    // Async inline path uses the SAME injected fake (no separate seam/cache).
    await printInline(content, {
      theme: DARK_CORE,
      nerdFonts: false,
      stream: {} as NodeJS.WriteStream,
    });

    expect(calls.rendered).toBe(2);
    expect(calls.unmounted).toBe(2);
  });

  test("renderDialog throws when the cache is cold", () => {
    __setInkForTests(null);
    expect(() => renderDialog(content, { theme: DARK_CORE, nerdFonts: false })).toThrow(
      /preloadDialogRuntime/,
    );
  });

  test("printInline self-warms when cold (no preload required)", async () => {
    // No injection: printInline must import the real Ink on demand without
    // throwing. A throwaway writable stream stands in for the terminal.
    const stream = { write() {}, columns: 80 } as unknown as NodeJS.WriteStream;
    await printInline(content, { theme: DARK_CORE, nerdFonts: false, stream });
  });
});
