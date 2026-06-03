import { afterEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { DARK_CORE, LIGHT_CORE } from "../src/theme/index.ts";
import { __setInkForTests } from "../src/tui/ink-runtime.ts";
import { printInline } from "../src/tui/print-inline.ts";
import { ThemeProvider } from "../src/tui/theme-context.tsx";

/** A sentinel standing in for Ink's `<Static>` component. */
function FakeStatic(): ReactElement {
  return createElement("fake-static");
}

/** Fake Ink renderer capturing render args and unmount calls. */
function fakeInk() {
  const calls: {
    renderArgs: Array<{ element: ReactElement; options?: Record<string, unknown> }>;
    unmounted: number;
  } = { renderArgs: [], unmounted: 0 };
  const ink = {
    Static: FakeStatic,
    render(element: ReactElement, options?: Record<string, unknown>) {
      calls.renderArgs.push({ element, options });
      return {
        rerender() {},
        unmount() {
          calls.unmounted += 1;
        },
      };
    },
  };
  return { ink, calls };
}

const content = createElement("inline-content");

afterEach(() => {
  __setInkForTests(null);
});

describe("printInline", () => {
  test("wraps the element in ThemeProvider then Static, with the passed theme", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink as Parameters<typeof __setInkForTests>[0]);
    const stream = {} as NodeJS.WriteStream;

    await printInline(content, { theme: DARK_CORE, nerdFonts: true, stream });

    expect(calls.renderArgs).toHaveLength(1);
    const wrapped = calls.renderArgs[0]?.element as ReactElement;
    expect(wrapped.type).toBe(ThemeProvider);
    const providerProps = wrapped.props as {
      theme: unknown;
      nerdFonts: boolean;
      children: ReactElement;
    };
    expect(providerProps.theme).toBe(DARK_CORE);
    expect(providerProps.nerdFonts).toBe(true);

    // Inside the provider sits a <Static> committing exactly our element.
    const staticEl = providerProps.children;
    expect(staticEl.type).toBe(FakeStatic);
    expect((staticEl.props as { items: ReactElement[] }).items).toEqual([content]);
  });

  test("renders to the given stream with stdin-free, non-console-patching options", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink as Parameters<typeof __setInkForTests>[0]);
    const stream = {} as NodeJS.WriteStream;

    await printInline(content, { theme: LIGHT_CORE, nerdFonts: false, stream });

    const options = calls.renderArgs[0]?.options;
    expect(options?.stdout).toBe(stream);
    expect(options?.patchConsole).toBe(false);
    expect(options).not.toHaveProperty("stdin");
  });

  test("defaults the stream to process.stdout", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink as Parameters<typeof __setInkForTests>[0]);

    await printInline(content, { theme: DARK_CORE, nerdFonts: false });

    expect(calls.renderArgs[0]?.options?.stdout).toBe(process.stdout);
  });

  test("tears down the Ink app after flushing", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink as Parameters<typeof __setInkForTests>[0]);

    await printInline(content, {
      theme: DARK_CORE,
      nerdFonts: false,
      stream: {} as NodeJS.WriteStream,
    });

    expect(calls.unmounted).toBe(1);
  });
});
