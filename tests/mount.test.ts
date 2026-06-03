import { describe, expect, test } from "bun:test";
import { createElement, type ReactElement } from "react";
import { mount } from "../src/tui/mount.ts";

/** A fake Ink renderer recording the element + options it was rendered with,
 *  and surfacing the instance's `rerender`/`unmount` calls. */
function fakeInk() {
  const calls: {
    renderArgs: Array<{ element: ReactElement; options?: Record<string, unknown> }>;
    rerendered: ReactElement[];
    unmounted: number;
  } = { renderArgs: [], rerendered: [], unmounted: 0 };
  const ink = {
    render(element: ReactElement, options?: Record<string, unknown>) {
      calls.renderArgs.push({ element, options });
      return {
        rerender(next: ReactElement) {
          calls.rerendered.push(next);
        },
        unmount() {
          calls.unmounted += 1;
        },
      };
    },
  };
  return { ink, calls };
}

/** A fake stdin stream that records destroy() calls. */
function fakeStream(): { stream: NodeJS.ReadStream; destroyed: number } {
  const state = { destroyed: 0 };
  const stream = {
    destroy() {
      state.destroyed += 1;
    },
  } as unknown as NodeJS.ReadStream;
  return {
    stream,
    get destroyed() {
      return state.destroyed;
    },
  };
}

const el = createElement("x");

describe("mount", () => {
  test("renders the element with inkOptions + the chosen stdin stream", () => {
    const { ink, calls } = fakeInk();
    const { stream } = fakeStream();
    mount(ink, el, { inkOptions: { alternateScreen: true }, stdin: { stream, fd: null } });
    expect(calls.renderArgs).toHaveLength(1);
    expect(calls.renderArgs[0]?.element).toBe(el);
    expect(calls.renderArgs[0]?.options).toMatchObject({ alternateScreen: true, stdin: stream });
  });

  test("rerender delegates to the Ink instance", () => {
    const { ink, calls } = fakeInk();
    const { stream } = fakeStream();
    const tree = mount(ink, el, { stdin: { stream, fd: null } });
    const next = createElement("y");
    tree.rerender(next);
    expect(calls.rerendered).toEqual([next]);
  });

  test("unmount calls the instance unmount THEN destroys the owned stream when fd !== null", () => {
    const { ink, calls } = fakeInk();
    const order: string[] = [];
    const stream = {
      destroy() {
        order.push("destroy");
      },
    } as unknown as NodeJS.ReadStream;
    // Wrap the fake ink so we record unmount ordering relative to destroy.
    const inkOrdered = {
      render(element: ReactElement, options?: Record<string, unknown>) {
        const inst = ink.render(element, options);
        return {
          rerender: inst.rerender,
          unmount() {
            order.push("ink-unmount");
            inst.unmount();
          },
        };
      },
    };
    const tree = mount(inkOrdered, el, { stdin: { stream, fd: 7 } });
    tree.unmount();
    expect(order).toEqual(["ink-unmount", "destroy"]);
    expect(calls.unmounted).toBe(1);
  });

  test("unmount does NOT destroy the stream when fd is null (borrowed stdin)", () => {
    const { ink } = fakeInk();
    const fs = fakeStream();
    const tree = mount(ink, el, { stdin: { stream: fs.stream, fd: null } });
    tree.unmount();
    expect(fs.destroyed).toBe(0);
  });

  test("unmount tolerates a stream without a destroy method", () => {
    const { ink } = fakeInk();
    const stream = {} as unknown as NodeJS.ReadStream;
    const tree = mount(ink, el, { stdin: { stream, fd: 7 } });
    expect(() => tree.unmount()).not.toThrow();
  });
});
