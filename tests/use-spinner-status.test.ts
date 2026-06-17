import { describe, expect, test } from "bun:test";
import { SPINNER_FRAMES } from "../src/chrome/index.ts";
import { spinnerStatus } from "../src/tui/use-spinner-status.ts";

describe("spinnerStatus", () => {
  test("no label → undefined, so the border draws plain", () => {
    expect(spinnerStatus(undefined, 0)).toBeUndefined();
    expect(spinnerStatus("", 0)).toBeUndefined();
  });

  test("prefixes the current frame and a single space before the label", () => {
    expect(spinnerStatus("Analyzing…", 0)).toBe(`${SPINNER_FRAMES[0]} Analyzing…`);
    expect(spinnerStatus("Analyzing…", 3)).toBe(`${SPINNER_FRAMES[3]} Analyzing…`);
  });

  test("frame index wraps around the frame list", () => {
    const n = SPINNER_FRAMES.length;
    expect(spinnerStatus("x", n)).toBe(`${SPINNER_FRAMES[0]} x`);
    expect(spinnerStatus("x", n + 2)).toBe(`${SPINNER_FRAMES[2]} x`);
  });

  test("noAnimation shows the bare label, no frame — still occupies the border", () => {
    expect(spinnerStatus("Loading models…", 5, true)).toBe("Loading models…");
  });
});
