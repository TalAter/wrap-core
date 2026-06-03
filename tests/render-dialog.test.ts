import { afterEach, describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { DARK_CORE, LIGHT_CORE } from "../src/theme/index.ts";
import { __setInkForTests } from "../src/tui/ink-runtime.ts";
import { openDialog, type RenderedDialog, renderDialog } from "../src/tui/render-dialog.ts";
import { ThemeProvider } from "../src/tui/theme-context.tsx";

type FakeInk = Parameters<typeof __setInkForTests>[0];

/** Fake Ink renderer capturing the element trees handed to render/rerender. */
function fakeInk() {
  const calls: { rendered: ReactElement[]; rerendered: ReactElement[]; unmounted: number } = {
    rendered: [],
    rerendered: [],
    unmounted: 0,
  };
  const ink = {
    render(element: ReactElement) {
      calls.rendered.push(element);
      return {
        rerender(next: ReactElement) {
          calls.rerendered.push(next);
        },
        unmount() {
          calls.unmounted += 1;
        },
      };
    },
  } as unknown as FakeInk;
  return { ink, calls };
}

/** Assert an element is a ThemeProvider wrapping `child` with the given theme. */
function expectThemeWrap(
  el: ReactElement,
  expected: { theme: unknown; nerdFonts: boolean; child: ReactElement },
) {
  expect(el.type).toBe(ThemeProvider);
  const props = el.props as { theme: unknown; nerdFonts: boolean; children: ReactElement };
  expect(props.theme).toBe(expected.theme);
  expect(props.nerdFonts).toBe(expected.nerdFonts);
  expect(props.children).toBe(expected.child);
}

const content = createElement("dialog-content");

afterEach(() => {
  __setInkForTests(null);
});

describe("renderDialog", () => {
  test("throws if preloadDialogRuntime() hasn't run", () => {
    __setInkForTests(null);
    expect(() => renderDialog(content, { theme: DARK_CORE, nerdFonts: false })).toThrow(
      /preloadDialogRuntime/,
    );
  });

  test("wraps the element in ThemeProvider with the passed theme/nerdFonts", () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    renderDialog(content, { theme: DARK_CORE, nerdFonts: true });
    expect(calls.rendered).toHaveLength(1);
    expectThemeWrap(calls.rendered[0] as ReactElement, {
      theme: DARK_CORE,
      nerdFonts: true,
      child: content,
    });
  });

  test("rerender re-wraps the next element with the theme captured at mount", () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    const app = renderDialog(content, { theme: LIGHT_CORE, nerdFonts: false });
    const next = createElement("next-content");
    app.rerender(next);
    expect(calls.rerendered).toHaveLength(1);
    expectThemeWrap(calls.rerendered[0] as ReactElement, {
      theme: LIGHT_CORE,
      nerdFonts: false,
      child: next,
    });
  });

  test("unmount is synchronous and tears down the Ink app", () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    const app = renderDialog(content, { theme: DARK_CORE, nerdFonts: false });
    const result = app.unmount();
    expect(result).toBeUndefined();
    expect(calls.unmounted).toBe(1);
  });
});

describe("openDialog", () => {
  test("resolves with the value passed to close (submit) and unmounts", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    let capturedClose: ((v: string) => void) | undefined;
    const promise = openDialog<string>({ theme: DARK_CORE, nerdFonts: false }, (close) => {
      capturedClose = close;
      return content;
    });
    // The build content was theme-wrapped and mounted.
    expectThemeWrap(calls.rendered[0] as ReactElement, {
      theme: DARK_CORE,
      nerdFonts: false,
      child: content,
    });
    capturedClose?.("answer");
    expect(await promise).toBe("answer");
    expect(calls.unmounted).toBe(1);
  });

  test("resolves with null (cancel) and unmounts", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    let capturedClose: ((v: string | null) => void) | undefined;
    const promise = openDialog<string | null>({ theme: DARK_CORE, nerdFonts: false }, (close) => {
      capturedClose = close;
      return content;
    });
    capturedClose?.(null);
    expect(await promise).toBeNull();
    expect(calls.unmounted).toBe(1);
  });

  test("forwards theme to renderDialog so build returns plain content", async () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    let close: ((v: number) => void) | undefined;
    const promise = openDialog<number>({ theme: LIGHT_CORE, nerdFonts: true }, (c) => {
      close = c;
      return content;
    });
    expectThemeWrap(calls.rendered[0] as ReactElement, {
      theme: LIGHT_CORE,
      nerdFonts: true,
      child: content,
    });
    close?.(1);
    await promise;
  });
});

describe("__setInkForTests", () => {
  test("a fake ink injected via the seam is used by renderDialog", () => {
    const { ink, calls } = fakeInk();
    __setInkForTests(ink);
    const app: RenderedDialog = renderDialog(content, { theme: DARK_CORE, nerdFonts: false });
    app.unmount();
    expect(calls.rendered).toHaveLength(1);
  });
});
