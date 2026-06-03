import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import stringWidth from "string-width";
import { ERASE_LINE, HIDE_CURSOR, SHOW_CURSOR } from "../src/ansi/index.ts";
import {
  _resetExitTeardownRegistryForTests,
  registerExitTeardown,
  resetExitGuard,
  SPINNER_FRAMES,
  SPINNER_INTERVAL,
  SPINNER_TEXT,
  startChromeSpinner,
} from "../src/chrome/spinner.ts";

/** Capture stderr writes + isTTY for the duration of a block. */
function mockStderr(opts: { isTTY: boolean }): {
  lines: string[];
  text: string;
  restore(): void;
} {
  const lines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  const originalIsTTY = process.stderr.isTTY;
  Object.defineProperty(process.stderr, "isTTY", { value: opts.isTTY, configurable: true });
  process.stderr.write = ((s: string) => {
    lines.push(s);
    return true;
  }) as typeof process.stderr.write;
  return {
    lines,
    get text() {
      return lines.join("");
    },
    restore() {
      process.stderr.write = originalWrite;
      Object.defineProperty(process.stderr, "isTTY", {
        value: originalIsTTY,
        configurable: true,
      });
    },
  };
}

describe("SPINNER_FRAMES", () => {
  test("all frames have consistent visual width", () => {
    // The frame sits in a fixed-width slot inside the dialog border — frames
    // that disagree on width would shift the trailing dashes each tick.
    const widths = SPINNER_FRAMES.map((f) => stringWidth(f));
    const first = widths[0];
    expect(widths.every((w) => w === first)).toBe(true);
  });
});

describe("startChromeSpinner", () => {
  test("writes the text and a frame to stderr", () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      expect(stderr.lines.some((w) => w.includes(SPINNER_TEXT))).toBe(true);
      expect(stderr.lines.some((w) => SPINNER_FRAMES.some((f) => w.includes(f.trim())))).toBe(true);
      stop();
    } finally {
      stderr.restore();
    }
  });

  test("hides the cursor on start and restores it on stop", () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      expect(stderr.text).toContain(HIDE_CURSOR);
      stop();
      expect(stderr.text).toContain(SHOW_CURSOR);
    } finally {
      stderr.restore();
    }
  });

  test("stop clears the line so the spinner disappears", () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      stop();
      const tail = stderr.lines[stderr.lines.length - 1] ?? "";
      expect(tail).toContain("\r");
      expect(tail).toContain(ERASE_LINE);
    } finally {
      stderr.restore();
    }
  });

  test("stop is idempotent — second call writes nothing extra", () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      stop();
      const after = stderr.lines.length;
      stop();
      expect(stderr.lines.length).toBe(after);
    } finally {
      stderr.restore();
    }
  });

  test("advances frames on the configured interval", async () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      await new Promise((r) => setTimeout(r, SPINNER_INTERVAL * 3 + 30));
      stop();
      const seen = new Set<string>();
      for (const w of stderr.lines) {
        for (const f of SPINNER_FRAMES) {
          if (w.includes(f.trim())) seen.add(f);
        }
      }
      expect(seen.size).toBeGreaterThanOrEqual(2);
    } finally {
      stderr.restore();
    }
  });

  test("never renders out-of-bounds frame data", async () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      await new Promise((r) => setTimeout(r, SPINNER_INTERVAL * 5 + 30));
      stop();
      expect(stderr.text).not.toContain("undefined");
    } finally {
      stderr.restore();
    }
  });

  test("noAnimation: shows text once, no cursor hide, no frames", async () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT, { noAnimation: true });
      await new Promise((r) => setTimeout(r, SPINNER_INTERVAL * 3 + 30));
      stop();
      expect(stderr.text).not.toContain(HIDE_CURSOR);
      const seenFrames = SPINNER_FRAMES.filter((f) =>
        stderr.lines.some((w) => w.includes(f.trim())),
      );
      expect(seenFrames).toEqual([]);
      expect(stderr.lines.some((w) => w.includes(SPINNER_TEXT))).toBe(true);
    } finally {
      stderr.restore();
    }
  });

  test("noAnimation: stop clears the line", () => {
    const stderr = mockStderr({ isTTY: true });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT, { noAnimation: true });
      stop();
      const tail = stderr.lines[stderr.lines.length - 1] ?? "";
      expect(tail).toContain("\r");
      expect(tail).toContain(ERASE_LINE);
    } finally {
      stderr.restore();
    }
  });

  test("no-op when stderr is not a TTY", () => {
    const stderr = mockStderr({ isTTY: false });
    try {
      const stop = startChromeSpinner(SPINNER_TEXT);
      stop();
      expect(stderr.lines).toHaveLength(0);
    } finally {
      stderr.restore();
    }
  });
});

// ── Exit-teardown guard ──────────────────────────────────────────────

describe("exit-teardown guard", () => {
  let originalOn: typeof process.on;
  let originalWrite: typeof process.stderr.write;
  let originalIsTTY: boolean | undefined;
  let exitListeners: Array<() => void>;
  let sigintListeners: Array<() => void>;
  let sigtermListeners: Array<() => void>;
  let writes: string[];

  beforeEach(() => {
    // Reset module state so the install runs inside the test with our mock.
    resetExitGuard();
    originalOn = process.on.bind(process);
    originalWrite = process.stderr.write.bind(process.stderr);
    originalIsTTY = process.stderr.isTTY;
    Object.defineProperty(process.stderr, "isTTY", { value: true, configurable: true });
    exitListeners = [];
    sigintListeners = [];
    sigtermListeners = [];
    process.on = ((event: string, listener: () => void) => {
      if (event === "exit") exitListeners.push(listener);
      else if (event === "SIGINT") sigintListeners.push(listener);
      else if (event === "SIGTERM") sigtermListeners.push(listener);
      return process;
    }) as typeof process.on;
    writes = [];
    process.stderr.write = ((s: string) => {
      writes.push(s);
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.on = originalOn;
    process.stderr.write = originalWrite;
    Object.defineProperty(process.stderr, "isTTY", { value: originalIsTTY, configurable: true });
    resetExitGuard();
  });

  test("first registration installs exit/SIGINT/SIGTERM listeners exactly once", () => {
    registerExitTeardown("\x1b[<u");
    registerExitTeardown(SHOW_CURSOR);
    expect(exitListeners.length).toBe(1);
    expect(sigintListeners.length).toBe(1);
    expect(sigtermListeners.length).toBe(1);
  });

  test("registered bytes are written on exit", () => {
    registerExitTeardown("\x1b[<u");
    registerExitTeardown(SHOW_CURSOR);
    writes.length = 0;
    for (const l of exitListeners) l();
    const joined = writes.join("");
    expect(joined).toContain("\x1b[<u");
    expect(joined).toContain(SHOW_CURSOR);
  });

  test("unregister removes the subscriber before teardown fires", () => {
    const unregister = registerExitTeardown("\x1b[<u");
    registerExitTeardown(SHOW_CURSOR);
    unregister();
    writes.length = 0;
    for (const l of exitListeners) l();
    const joined = writes.join("");
    expect(joined).not.toContain("\x1b[<u");
    expect(joined).toContain(SHOW_CURSOR);
  });

  test("teardown is a no-op when stderr is not a TTY", () => {
    registerExitTeardown("\x1b[<u");
    Object.defineProperty(process.stderr, "isTTY", { value: false, configurable: true });
    writes.length = 0;
    for (const l of exitListeners) l();
    expect(writes.join("")).toBe("");
  });

  test("the spinner lazily registers a cursor-restore exit handler", () => {
    const stop = startChromeSpinner(SPINNER_TEXT);
    try {
      expect(exitListeners.length).toBeGreaterThanOrEqual(1);
      writes.length = 0;
      for (const l of exitListeners) l();
      expect(writes.some((w) => w.includes(SHOW_CURSOR))).toBe(true);
    } finally {
      stop();
    }
  });

  test("the spinner installs the exit handler exactly once across runs", () => {
    const start = exitListeners.length;
    const stop1 = startChromeSpinner(SPINNER_TEXT);
    stop1();
    const stop2 = startChromeSpinner(SPINNER_TEXT);
    stop2();
    const stop3 = startChromeSpinner(SPINNER_TEXT);
    stop3();
    expect(exitListeners.length - start).toBe(1);
  });

  test("SIGINT restores the cursor and exits with code 130", () => {
    const stop = startChromeSpinner(SPINNER_TEXT);
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
    }) as never;
    try {
      writes.length = 0;
      for (const l of sigintListeners) l();
      expect(writes.some((w) => w.includes(SHOW_CURSOR))).toBe(true);
      expect(exitCode).toBe(130);
    } finally {
      process.exit = origExit;
      stop();
    }
  });

  test("SIGTERM restores the cursor and exits with code 143", () => {
    const stop = startChromeSpinner(SPINNER_TEXT);
    const origExit = process.exit;
    let exitCode: number | undefined;
    process.exit = ((code: number) => {
      exitCode = code;
    }) as never;
    try {
      writes.length = 0;
      for (const l of sigtermListeners) l();
      expect(writes.some((w) => w.includes(SHOW_CURSOR))).toBe(true);
      expect(exitCode).toBe(143);
    } finally {
      process.exit = origExit;
      stop();
    }
  });

  test("resetExitGuard clears registrations and re-arms the install", () => {
    registerExitTeardown(SHOW_CURSOR);
    expect(exitListeners.length).toBe(1);
    resetExitGuard();
    // After reset the next registration installs a fresh listener and the old
    // registration is gone.
    registerExitTeardown("\x1b[<u");
    expect(exitListeners.length).toBe(2);
    writes.length = 0;
    for (const l of exitListeners) l();
    // Only the post-reset byte string is present.
    expect(writes.join("")).toContain("\x1b[<u");
  });

  test("_resetExitTeardownRegistryForTests delegates to resetExitGuard", () => {
    registerExitTeardown(SHOW_CURSOR);
    _resetExitTeardownRegistryForTests();
    registerExitTeardown("\x1b[<u");
    writes.length = 0;
    for (const l of exitListeners) l();
    const joined = writes.join("");
    expect(joined).toContain("\x1b[<u");
    expect(joined).not.toContain(SHOW_CURSOR);
  });
});
